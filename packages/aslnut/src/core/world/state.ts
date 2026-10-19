// core › world › state: the one object `s` every `when` and every per-view prop receives. It is built from the
// observation level, the orbit (the view: for render detail only, never a look or presence), the world's clock,
// params and readouts, the user and the device; never read the camera directly (headless runs and other hosts have
// none).
//   when: s => s.observation.level === 'room' && s.user.toggles.crime
import { D, R } from '../space/geo.ts';
import { timeState, type TimeState } from '../time/clock.ts';
import { NO_OBSERVATION, type ObservationState } from '../observation/levels.ts';

export type Api = 'webgpu' | 'webgl2' | 'none';
export type Quality = 'lite' | 'realistic';

export interface ViewState {
  lon: number; lat: number;
  /** web-map zoom level at the centre (z 0 = the world in one 256 px tile) */
  zoom: number;
  /** metres from the camera to the centre */
  dist: number;
  /** degrees from looking straight down (0) towards the horizon (90) */
  tilt: number;
  /** degrees, 0 = north up */
  bearing: number;
  /** metres above the centre */
  altitude: number;
  /** metres per CSS pixel at the centre */
  pixelSize: number;
  /** the frame in CSS pixels */
  width: number; height: number;
  /** 0 = globe … 1 = flat map */
  morph: number;
}
export interface UserState { selection: string[]; hover: string | null; toggles: Record<string, boolean>; role: string }
export interface DeviceState {
  api: Api;
  /** a rough class of the device: phones with little memory are low */
  tier: 'low' | 'mid' | 'high';
  /** why this graphics was chosen (shown in panels) */
  reason: string;
}
export interface State {
  /** the observation level looked at (core › observation; level null: a world with no levels) */
  observation: ObservationState;
  /** the orbit: where the eye is. For render detail and your own functions; a look or presence never reads it */
  view: ViewState;
  time: TimeState;
  world: { params: Readonly<Record<string, unknown>>; readouts: Readonly<Record<string, unknown>> };
  user: UserState;
  device: DeviceState;
  /** how it is drawn now: lite or realistic; the detail (1: full; lower: the governor holding a budget, coarser
   *  ground tiles and nearer levels of detail) */
  render: { quality: Quality; detail: number };
}

/** the zoom level for a distance (an 800 px tall reference frame, 50° vertical field of view) */
export const REF_H = 800, FOV = (50 * Math.PI) / 180;
export const zoomForDist = (dist: number, lat: number, h = REF_H, fov = FOV) =>
  Math.log2(((h / (2 * dist * Math.tan(fov / 2))) * 2 * Math.PI * R * Math.cos(lat * D)) / 256);
export const distForZoom = (zoom: number, lat: number, h = REF_H, fov = FOV) =>
  h / ((256 * 2 ** zoom) / (2 * Math.PI * R * Math.cos(lat * D))) / (2 * Math.tan(fov / 2));

/** a state with defaults (tests, headless worlds and tools build one without a camera) */
export function makeState(p: { observation?: ObservationState; view?: Partial<ViewState>; time?: Partial<TimeState>; params?: Record<string, unknown>; readouts?: Record<string, unknown>; user?: Partial<UserState>; device?: Partial<DeviceState>; quality?: Quality; detail?: number } = {}): State {
  const lat = p.view?.lat ?? 0, dist = p.view?.dist ?? (p.view?.zoom !== undefined ? distForZoom(p.view.zoom, lat) : R * 3);
  const h = p.view?.height ?? REF_H;
  const view: ViewState = {
    lon: 0, lat, zoom: zoomForDist(dist, lat), dist, tilt: 0, bearing: 0, altitude: dist,
    pixelSize: (2 * dist * Math.tan(FOV / 2)) / h, width: p.view?.width ?? 1200, height: h, morph: 0, ...p.view,
  };
  const now = p.time?.now ?? new Date(Date.UTC(2026, 0, 1, 5, 0, 0));
  return {
    observation: p.observation ?? NO_OBSERVATION,
    view,
    time: { ...timeState(now, view.lon, view.lat, 0), ...p.time },
    world: { params: p.params ?? {}, readouts: p.readouts ?? {} },
    user: { selection: [], hover: null, toggles: {}, role: 'viewer', ...p.user },
    device: { api: 'none', tier: 'mid', reason: 'headless', ...p.device },
    render: { quality: p.quality ?? 'realistic', detail: p.detail ?? 1 },
  };
}
