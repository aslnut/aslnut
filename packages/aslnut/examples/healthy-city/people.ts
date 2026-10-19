// The people of the street level, from aslnut's humans presets: the person you walk as (one of the ready-made people,
// chosen in the mode bar or with &person=…; the plain walker shape if the humans pack cannot load), and a light crowd
// walking the footpaths' graph round the camera (sized for a phone; &people=0 turns it off, &people=40 asks for 40,
// &radius=60 keeps them within 60 m).
import { entityElement, network, type EntityElement, type Network, type World } from '../../src/index.ts';
import { PEOPLE, crowd, humanFigure, loadTemplate, paletteOf, decalOf, personEntity, type Crowd, type HumanFigure, type Template, type Tone } from '../../src/modules/presets/humans/index.ts';
import type { AvatarBody } from '../../src/kits/game/index.ts';
import { log } from './page.ts';

type LL = [number, number];
const HUMANS = '/aslnut/data/packs/humans/template.json';
/** the walking graph's lines within this many metres of the camera make the crowd's network (rebuilt as it moves) */
const NEAR = 450;
// the people in greys (each colour's lightness kept): &tone=colour for their colours
const TONE: Tone = new URLSearchParams(location.search).get('tone') === 'colour' ? 'colour' : 'grey';
export interface StreetPeople {
  /** the person walked as (null: the plain walker) */
  avatar: (name: string | null) => Promise<AvatarBody | null>;
  /** the crowd (null when turned off) */
  crowd: Crowd | null;
  /** the ready-made people's names */
  names: string[];
  template: () => Promise<Template>;
}
export function streetPeople(w: World, o: { walkUrl: string; count: number; radius?: number; around: () => LL; shown: () => boolean }): StreetPeople {
  let tpl: Promise<Template> | null = null;
  const template = () => (tpl ??= loadTemplate(HUMANS));
  // the footpaths' graph (lines of local metres from its origin), loaded when the crowd first needs it
  let walk: Promise<{ lines: { line: LL[] }[] } | null> | null = null, net: { at: LL; net: Network<unknown> } | null = null, building = false;
  const loadWalk = () => (walk ??= fetch(o.walkUrl).then((r) => (r.ok ? r.json() : null)).then((j: { origin: LL; lines: (string | number)[][] } | null) => {
    if (!j) return null;
    const kx = 111320 * Math.cos((j.origin[1] * Math.PI) / 180), ll = (x: number, z: number): LL => [j.origin[0] + x / kx, j.origin[1] - z / 110574];
    const lines = j.lines.map((l) => { const pts: LL[] = []; for (let i = 1; i + 1 < l.length; i += 2) pts.push(ll(l[i] as number, l[i + 1] as number)); return { line: pts }; });
    log('people-walk-graph', { lines: lines.length }); return { lines };
  }).catch(() => null));
  // the network round the camera: the lines with a point within NEAR metres, rebuilt when it has moved a third of that
  const networkNow = (): Network<unknown> | null => {
    const c = o.around();
    if (net && Math.hypot((c[0] - net.at[0]) * 88000, (c[1] - net.at[1]) * 110574) < NEAR / 3) return net.net;
    if (!building) {
      building = true;
      void loadWalk().then((g) => {
        building = false; if (!g) return;
        const kx = 111320 * Math.cos((c[1] * Math.PI) / 180), near = g.lines.filter((l) => l.line.some((p) => Math.hypot((p[0] - c[0]) * kx, (p[1] - c[1]) * 110574) < NEAR));
        if (near.length) { net = { at: c, net: network({ lines: near, snap: 0.05 }) }; w.invalidate(); }
      });
    }
    return net?.net ?? null;
  };
  const figs = new Map<string, HumanFigure>();
  return {
    names: Object.keys(PEOPLE),
    template,
    async avatar(name) {
      if (!name || !PEOPLE[name]) return null;
      try {
        const t = await template(), p = PEOPLE[name]!;
        let f = figs.get(name); if (!f) figs.set(name, (f = humanFigure(t, p.figure)));
        return { figure: () => f!, palette: paletteOf(p, TONE), decal: decalOf(p), scale: p.scale };
      } catch (e) { log('people-avatar-failed', { name, e: String((e as Error)?.message ?? e) }); return null; }
    },
    crowd: o.count > 0 ? crowd(w, { template, network: networkNow, around: o.around, count: o.count, figures: Math.min(8, o.count), radius: o.radius ?? 100, seed: 11, id: 'people', tone: TONE, bodies: { budget: Math.min(24, o.count), pixels: 24 }, when: () => o.shown() }) : null,
  };
}

/** the ready-made people standing side by side at a place, facing a camera at eye height a few metres back (the view
 *  faces `bearing`; the camera may come down to a person's height: its own view, the link's) */
export async function lineup(w: World, template: () => Promise<Template>, o: { at: LL; bearing: number; near?: number; names?: string[]; doing?: Record<string, string> }): Promise<EntityElement> {
  const t = await template(), D = Math.PI / 180, names = o.names ?? Object.keys(PEOPLE), layer = entityElement({ id: 'lineup', bodies: { budget: 32, pixels: 8 } });
  // a view's centre is on the ground: the camera looks down 10° at a point behind them, its middle on their chests
  const tilt = 80, near = o.near ?? 6, h = 1.05 + near * Math.tan((90 - tilt) * D), dist = h / Math.cos(tilt * D), back = dist * Math.sin(tilt * D) - near;
  const b = o.bearing * D, kx = 111320 * Math.cos(o.at[1] * D), east = Math.sin(b), north = Math.cos(b);
  names.forEach((name, i) => {
    const p = PEOPLE[name]!, off = (i - (names.length - 1) / 2) * 1.05, fig = humanFigure(t, { ...p.figure, poses: { wave: 'wave', greet: 'greet', phone: 'phone' } });
    const e = personEntity({ ...p, face: { ...p.face, blinks: false } }, fig, { id: `lineup-${name}`, at: [o.at[0] + (north * off) / kx, o.at[1] - (east * off) / 110574], heading: o.bearing + 180, tone: TONE });
    const clip = o.doing?.[name] ?? 'idle'; e.motion = () => ({ clip, at: 0.2 }); layer.add(e);
  });
  // (the camera goes there once the street round the start has settled: a jump while its first tiles build can leave
  // one of them building)
  await w.settled({ timeout: 300000 }).catch(() => {});
  w.camera.minDist = 1;
  // (a view's dist is framed for the screen's shape: a tall phone screen takes it farther, by frameK)
  w.go({ lon: o.at[0] + (east * back) / kx, lat: o.at[1] + (north * back) / 110574, dist: dist / w.camera.frameK, tilt, bearing: o.bearing } as never);
  w.add(layer);
  return layer;
}
