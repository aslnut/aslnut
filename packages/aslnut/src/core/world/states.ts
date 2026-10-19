// core › world › states: an answer as a presentation. A state is plain JSON: where the camera is, the world's
// time, the observation level, the quality, each element shown or hidden with its params and filter, the selection
// and the toggles. Capture one, apply it (the camera flies with an easing preset, elements reveal or hide), compare
// two, check one against the schema, and share it in a URL. A state only reads and writes what exists: elements it
// names that the world does not have are reported, never made.
//   const answer = w.capture({ note: 'Where is burglary highest?' })
//   await w.apply(answer, { seconds: 2.5, ease: 'cinematic' })
//   states.diff(a, b) · states.validate(json) · states.toURL(answer) · states.fromURL(location.href)
import type { Ease } from '../observation/observers/orbit/ease.ts';
import type { Path } from '../observation/observers/orbit/keys.ts';
import { AslnutError } from './errors.ts';
import type { Quality } from './state.ts';
import { shown } from '../observation/presence.ts';
import type { World } from './world.ts';

export interface ElementState {
  /** shown (its reveal plays) or hidden; absent: follow its `when` */
  shown?: boolean;
  /** its knobs (numbers, vectors, colours) */
  params?: Record<string, number | number[] | string | boolean>;
  /** which features: props to match ({ type: 'school' }, { type: ['a', 'b'] }, { rate: { min: 10 } }); null: all */
  filter?: Record<string, unknown> | null;
}
export interface WorldState {
  /** the format version */
  v: 1;
  /** a title for the answer */
  note?: string;
  view: { lon: number; lat: number; zoom: number; tilt: number; bearing: number };
  /** the world's time (ISO 8601) */
  time?: string;
  /** the observation level looked at (core › observation: a world with levels) */
  observation?: { level?: string };
  /** how it is drawn */
  render?: { quality?: Quality };
  elements: Record<string, ElementState>;
  /** world params not of an element (w.param('fault.glow', …)) */
  params?: Record<string, number | number[] | string | boolean>;
  selection: string[];
  toggles?: Record<string, boolean>;
}
export interface CaptureOptions { note?: string; /** only these elements (default every element but the sky) */ elements?: string[]; /** leave the time out */ time?: boolean }
export interface ApplyOptions {
  /** seconds the camera takes (0: jump; default: what the distance feels like) */
  seconds?: number;
  ease?: Ease;
  path?: Path;
  /** what it does with elements the state does not name: leave them (default) or hide them */
  others?: 'keep' | 'hide';
}
export interface ApplyReport { /** elements the state names that this world has not */ missing: string[]; /** params it could not set */ refused: string[] }
export interface Change { path: string; from: unknown; to: unknown }

/** the JSON Schema of a state (draft 2020-12): for tools, assistants and servers that store answers */
export const STATE_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://aslnut.dev/schema/state-1.json',
  title: 'aslnut world state',
  type: 'object',
  required: ['v', 'view', 'elements', 'selection'],
  additionalProperties: false,
  properties: {
    v: { const: 1 },
    note: { type: 'string' },
    view: {
      type: 'object', required: ['lon', 'lat', 'zoom', 'tilt', 'bearing'], additionalProperties: false,
      properties: { lon: { type: 'number', minimum: -180, maximum: 180 }, lat: { type: 'number', minimum: -90, maximum: 90 }, zoom: { type: 'number', minimum: -2, maximum: 26 }, tilt: { type: 'number', minimum: 0, maximum: 90 }, bearing: { type: 'number' } },
    },
    time: { type: 'string', format: 'date-time' },
    observation: { type: 'object', additionalProperties: false, properties: { level: { type: 'string' } } },
    render: { type: 'object', additionalProperties: false, properties: { quality: { enum: ['lite', 'realistic'] } } },
    elements: {
      type: 'object',
      propertyNames: { pattern: '^[A-Za-z0-9_-]+$' },
      additionalProperties: {
        type: 'object', additionalProperties: false,
        properties: {
          shown: { type: 'boolean' },
          params: { type: 'object', additionalProperties: { type: ['number', 'string', 'boolean', 'array'], items: { type: 'number' } } },
          filter: { type: ['object', 'null'] },
        },
      },
    },
    params: { type: 'object', additionalProperties: { type: ['number', 'string', 'boolean', 'array'], items: { type: 'number' } } },
    selection: { type: 'array', items: { type: 'string' } },
    toggles: { type: 'object', additionalProperties: { type: 'boolean' } },
  },
} as const;

const bad = (path: string, what: string, fix: string) => new AslnutError('E-STATE-001', `${path}: ${what}`, { where: path, fix });
const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const num = (x: unknown) => typeof x === 'number' && Number.isFinite(x);
const paramOk = (x: unknown) => num(x) || typeof x === 'string' || typeof x === 'boolean' || (Array.isArray(x) && x.every(num));
/** check a state against the schema; throws E-STATE-001 naming the path and the fix, else returns it typed */
export function validate(x: unknown): WorldState {
  if (!isObj(x)) throw bad('state', 'is not an object', 'a state is { v: 1, view, elements, selection }');
  for (const k of Object.keys(x)) if (!(k in STATE_SCHEMA.properties)) throw bad(`state.${k}`, 'is not a state field', `use ${Object.keys(STATE_SCHEMA.properties).join(', ')}`);
  if (x.v !== 1) throw bad('state.v', `is ${JSON.stringify(x.v)}`, 'this aslnut reads version 1 (v: 1)');
  if (x.note !== undefined && typeof x.note !== 'string') throw bad('state.note', 'is not text', 'write a string');
  const v = x.view;
  if (!isObj(v)) throw bad('state.view', 'is missing', 'give { lon, lat, zoom, tilt, bearing }');
  for (const k of ['lon', 'lat', 'zoom', 'tilt', 'bearing']) if (!num(v[k])) throw bad(`state.view.${k}`, `is ${JSON.stringify(v[k])}`, 'give a number');
  for (const k of Object.keys(v)) if (!['lon', 'lat', 'zoom', 'tilt', 'bearing'].includes(k)) throw bad(`state.view.${k}`, 'is not a view field', 'use lon, lat, zoom, tilt, bearing');
  if ((v.lon as number) < -180 || (v.lon as number) > 180) throw bad('state.view.lon', `${v.lon} is outside -180..180`, 'longitude first, then latitude');
  if ((v.lat as number) < -90 || (v.lat as number) > 90) throw bad('state.view.lat', `${v.lat} is outside -90..90`, 'did you swap lon and lat?');
  if ((v.zoom as number) < -2 || (v.zoom as number) > 26) throw bad('state.view.zoom', `${v.zoom} is outside -2..26`, 'a web-map zoom level');
  if ((v.tilt as number) < 0 || (v.tilt as number) > 90) throw bad('state.view.tilt', `${v.tilt} is outside 0..90`, 'degrees from straight down');
  if (x.time !== undefined && (typeof x.time !== 'string' || Number.isNaN(Date.parse(x.time)))) throw bad('state.time', `${JSON.stringify(x.time)} is not a date`, "write an ISO 8601 time, like '2026-10-12T04:00:00Z'");
  if (x.observation !== undefined) {
    if (!isObj(x.observation)) throw bad('state.observation', 'is not an object', 'give { level }');
    for (const k of Object.keys(x.observation)) if (k !== 'level') throw bad(`state.observation.${k}`, 'is not an observation field', 'use level (the quality is render.quality)');
    if (x.observation.level !== undefined && typeof x.observation.level !== 'string') throw bad('state.observation.level', `is ${JSON.stringify(x.observation.level)}`, "a level's name, like 'street'");
  }
  if (x.render !== undefined) {
    if (!isObj(x.render)) throw bad('state.render', 'is not an object', 'give { quality }');
    for (const k of Object.keys(x.render)) if (k !== 'quality') throw bad(`state.render.${k}`, 'is not a render field', 'use quality');
    if (x.render.quality !== undefined && x.render.quality !== 'lite' && x.render.quality !== 'realistic') throw bad('state.render.quality', `is ${JSON.stringify(x.render.quality)}`, "use 'lite' or 'realistic'");
  }
  if (!isObj(x.elements)) throw bad('state.elements', 'is missing', 'give { [element id]: { shown, params, filter } } ({} for none)');
  for (const [id, l] of Object.entries(x.elements)) {
    const p = `state.elements.${id}`;
    if (!/^[A-Za-z0-9_-]+$/.test(id)) throw bad(p, 'is not an element id', "letters, digits, '-' and '_'");
    if (!isObj(l)) throw bad(p, 'is not an object', 'give { shown, params, filter }');
    for (const k of Object.keys(l)) if (!['shown', 'params', 'filter'].includes(k)) throw bad(`${p}.${k}`, 'is not an element field', 'use shown, params, filter');
    if (l.shown !== undefined && typeof l.shown !== 'boolean') throw bad(`${p}.shown`, `is ${JSON.stringify(l.shown)}`, 'true or false');
    if (l.params !== undefined) { if (!isObj(l.params)) throw bad(`${p}.params`, 'is not an object', 'give { name: value }'); for (const [k, pv] of Object.entries(l.params)) if (!paramOk(pv)) throw bad(`${p}.params.${k}`, `is ${JSON.stringify(pv)}`, 'a number, numbers, text or a boolean'); }
    if (l.filter !== undefined && l.filter !== null && !isObj(l.filter)) throw bad(`${p}.filter`, 'is not an object', 'give { prop: value } (or null for all)');
  }
  if (x.params !== undefined) { if (!isObj(x.params)) throw bad('state.params', 'is not an object', 'give { key: value }'); for (const [k, pv] of Object.entries(x.params)) if (!paramOk(pv)) throw bad(`state.params.${k}`, `is ${JSON.stringify(pv)}`, 'a number, numbers, text or a boolean'); }
  if (!Array.isArray(x.selection) || !x.selection.every((s) => typeof s === 'string')) throw bad('state.selection', 'is not a list of ids', 'give ["id", …] ([] for none)');
  if (x.toggles !== undefined) { if (!isObj(x.toggles)) throw bad('state.toggles', 'is not an object', 'give { name: true }'); for (const [k, t] of Object.entries(x.toggles)) if (typeof t !== 'boolean') throw bad(`state.toggles.${k}`, `is ${JSON.stringify(t)}`, 'true or false'); }
  return x as unknown as WorldState;
}

const r6 = (x: number) => Math.round(x * 1e6) / 1e6, r3 = (x: number) => Math.round(x * 1e3) / 1e3;
/** the world now, as a state */
export function capture(w: World, o: CaptureOptions = {}): WorldState {
  const v = w.camera.view, only = o.elements ? new Set(o.elements) : null;
  const elements: Record<string, ElementState> = {}, params: Record<string, number | number[] | string | boolean> = {};
  const all = w.params(), st = w.state;
  for (const l of w.list) {
    if (l.kind === 'sky' || (only && !only.has(l.id))) continue;
    let on = l.forced; if (on === null) { try { on = shown(l.props.when, st, `layer '${l.id}'`) > 0.5; } catch { on = l.target > 0.5; } }
    const ls: ElementState = { shown: on };
    const ps: Record<string, number | number[] | string | boolean> = {};
    for (const [k, p] of Object.entries(all)) if (k.startsWith(`${l.id}.`) && paramOk(p.value)) ps[k.slice(l.id.length + 1)] = p.value as number;
    if (Object.keys(ps).length) ls.params = ps;
    const f = (l.props as { filter?: unknown }).filter;
    if (f && typeof f === 'object') ls.filter = JSON.parse(JSON.stringify(f));
    elements[l.id] = ls;
  }
  const ids = new Set(w.list.map((l) => l.id));
  for (const [k, p] of Object.entries(all)) if (!ids.has(k.split('.')[0]!) && paramOk(p.value)) params[k] = p.value as number;
  const s: WorldState = {
    v: 1, ...(o.note ? { note: o.note } : {}),
    view: { lon: r6(v.lon), lat: r6(v.lat), zoom: r3(v.zoom), tilt: r3(v.tilt), bearing: r3(((v.bearing % 360) + 360) % 360) },
    ...(o.time === false ? {} : { time: w.time.toISOString() }),
    ...(w.level !== null ? { observation: { level: w.level } } : {}),
    render: { quality: w.state.render.quality },
    elements, ...(Object.keys(params).length ? { params } : {}),
    selection: [...w.user.selection], ...(Object.keys(w.user.toggles).length ? { toggles: { ...w.user.toggles } } : {}),
  };
  return s;
}
/** make the world show a state: the camera flies there, elements reveal or hide, params, filter, selection, time */
export async function apply(w: World, state: unknown, o: ApplyOptions = {}): Promise<ApplyReport> {
  const s = validate(state), rep: ApplyReport = { missing: [], refused: [] };
  for (const [id, ls] of Object.entries(s.elements)) {
    let l; try { l = w.element(id); } catch { rep.missing.push(id); continue; }
    if (ls.shown !== undefined) l.forced = ls.shown;
    for (const [k, pv] of Object.entries(ls.params ?? {})) { try { w.set(`${id}.${k}`, pv); } catch { rep.refused.push(`${id}.${k}`); } }
    if (ls.filter !== undefined) l.setProps({ filter: ls.filter } as never);
  }
  if (o.others === 'hide') for (const l of w.list) if (l.kind !== 'sky' && l.kind !== 'basemap' && !(l.id in s.elements)) l.forced = false;
  for (const [k, pv] of Object.entries(s.params ?? {})) { try { w.set(k, pv); } catch { rep.refused.push(k); } }
  w.select(s.selection);
  if (s.toggles) for (const [k, t] of Object.entries(s.toggles)) w.toggle(k, t);
  if (s.time) w.setTime(new Date(s.time));
  if (s.render?.quality) w.setQuality(s.render.quality);
  if (s.observation?.level !== undefined && w.level !== null) w.setLevel(s.observation.level);
  const view = { lon: s.view.lon, lat: s.view.lat, zoom: s.view.zoom, tilt: s.view.tilt, bearing: s.view.bearing };
  if (o.seconds === 0) w.go(view); else await w.fly(view, { seconds: o.seconds, ease: o.ease ?? 'cinematic', path: o.path });
  return rep;
}
/** what differs between two states, path by path */
export function diff(a: WorldState, b: WorldState): Change[] {
  const out: Change[] = [];
  const walk = (x: unknown, y: unknown, path: string) => {
    if (isObj(x) && isObj(y)) { for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) walk(x[k], y[k], path ? `${path}.${k}` : k); return; }
    if (JSON.stringify(x) !== JSON.stringify(y)) out.push({ path, from: x, to: y });
  };
  walk(a, b, '');
  return out;
}
const b64 = (s: string) => (typeof btoa === 'function' ? btoa(s) : Buffer.from(s, 'binary').toString('base64'));
const unb64 = (s: string) => (typeof atob === 'function' ? atob(s) : Buffer.from(s, 'base64').toString('binary'));
/** a state as URL-safe text (UTF-8 JSON, base64url) */
export function encode(s: WorldState): string {
  const bytes = new TextEncoder().encode(JSON.stringify(validate(s)));
  let bin = ''; for (const b of bytes) bin += String.fromCharCode(b);
  return b64(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function decode(text: string): WorldState {
  let json: unknown;
  try {
    const bin = unb64(text.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((text.length + 3) % 4));
    json = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))));
  } catch { throw bad('state', 'could not be read from the text', 'pass what encode() or toURL() made'); }
  return validate(json);
}
/** a link that opens this state (the `state` param, or yours) */
export function toURL(s: WorldState, base: string = typeof location !== 'undefined' ? location.href : 'https://example.org/', param = 'state'): string {
  const u = new URL(base); u.searchParams.set(param, encode(s)); return u.toString();
}
/** the state in a link, or null when it has none */
export function fromURL(url: string = typeof location !== 'undefined' ? location.href : '', param = 'state'): WorldState | null {
  const t = new URL(url, 'https://example.org/').searchParams.get(param); return t ? decode(t) : null;
}
export const states = { capture, apply, diff, validate, encode, decode, toURL, fromURL, schema: STATE_SCHEMA };
