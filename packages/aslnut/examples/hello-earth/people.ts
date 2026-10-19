// people presets (?go=people | people-walk | parity-people): the humans presets on a plane, built with the public API.
// A lineup of the ready-made people (one of each age, light to deep skin), standing, posed and walking in place; and
// a few dozen people from seeds walking a grid of paths. The template comes from the humans pack (never bundled).
import { entityElement, network, plane, planeAt, type Entity, type Element, type World } from '../../src/index.ts';
import { PEOPLE, POSES, crowd, humanFigure, loadTemplate, personEntity, type HumanFigure, type Person, type Template } from '../../src/modules/presets/humans/index.ts';
import type { Preset } from './presets.ts';

const TEMPLATE = '/aslnut/data/packs/humans/template.json';
/** a view from the front at about eye height, its middle on the people's chests `near` metres away: the camera looks
 *  north down at a ground point far behind them (a view's centre is on the ground), the people stand `back` metres
 *  south of it */
const front = (near: number, tilt: number, chest = 1.05) => { const a = ((90 - tilt) * Math.PI) / 180, h = chest + near * Math.tan(a), dist = h / Math.cos((tilt * Math.PI) / 180); return { view: { lon: 0, lat: 0, dist, tilt, bearing: 0 }, back: dist * Math.sin((tilt * Math.PI) / 180) - near }; };
const ALL = front(12, 80), FACES = front(4, 80);
let tpl: Promise<Template> | null = null;
const template = () => (tpl ??= loadTemplate(TEMPLATE));
/** the lineup: what each one does (a still pose, a walk at a fixed phase, standing at ease) */
const DOING: Record<string, { clip: string; at: number }> = {
  'office-worker': { clip: 'walk', at: 0.15 }, student: { clip: 'phone', at: 0 }, grandmother: { clip: 'idle', at: 0 }, grandfather: { clip: 'walk', at: 0.6 },
  girl: { clip: 'wave', at: 0 }, boy: { clip: 'run', at: 0.3 }, runner: { clip: 'run', at: 0.8 }, 'market-seller': { clip: 'idle', at: 0 },
  'teen-girl': { clip: 'walk', at: 0.4 }, 'big-man': { clip: 'idle', at: 0 }, 'tall-woman': { clip: 'walk', at: 0.85 }, father: { clip: 'greet', at: 0 },
};
function lineup(o: { parity?: boolean; moving?: boolean; at?: { view: { lon: number; lat: number; dist: number; tilt: number; bearing: number }; back: number }; only?: string[] }): { layer: Element; ready: (w: World) => Promise<void> } {
  const at = o.at ?? ALL;
  const layer = entityElement({ id: 'people', bodies: { budget: 64, pixels: 10 } });
  return {
    layer,
    async ready(w) {
      // a close view: the camera may come down to a person's height (the preset's own view, kept)
      w.camera.minDist = 1; w.go(at.view);
      const t = await template(), names = o.only ?? Object.keys(PEOPLE);
      names.forEach((name, i) => {
        const p: Person = PEOPLE[name]!, fig: HumanFigure = humanFigure(t, { ...p.figure, poses: { phone: 'phone', wave: 'wave', greet: 'greet' } });
        const e: Entity = personEntity({ ...p, face: { ...p.face, blinks: !o.parity } }, fig, { id: name, at: planeAt((i - (names.length - 1) / 2) * 1.05, -at.back), heading: 180 });
        const doing = DOING[name] ?? { clip: 'idle', at: 0 };
        // moving: the walkers and runners go through their cycle in place (the clock's seconds), the rest at ease;
        // still: each as listed, the student's pose made here (a pose of one's own: its own row, written once)
        if (o.moving) e.motion = () => ({ clip: doing.clip === 'run' || doing.clip === 'walk' ? doing.clip : 'idle', at: w.now / 1000 + i * 0.13 });
        else if (doing.clip === 'phone') { POSES.phone!(fig.rig.begin()); const fr = fig.rig.end(), own = { pose: Float32Array.from(fr.pose), morphs: fr.morphs }; e.motion = () => ({ pose: own, key: 'phone' }); }
        else e.motion = () => doing;
        layer.add(e);
      });
      w.invalidate();
    },
  };
}
/** a few dozen people from seeds walking a grid of paths (a plane's walking network) */
function walkers(): { layer: Element; ready: (w: World) => Promise<void> } {
  const lines: { line: [number, number][] }[] = [];
  // paths every 20 m, a piece between each crossing (the network joins pieces at their ends)
  for (let k = -4; k <= 4; k++) for (let m = -4; m < 4; m++) { lines.push({ line: [planeAt(m * 20, k * 20), planeAt(m * 20 + 20, k * 20)] }); lines.push({ line: [planeAt(k * 20, m * 20), planeAt(k * 20, m * 20 + 20)] }); }
  const net = network({ lines, snap: 0.5 });
  let c: ReturnType<typeof crowd> | null = null;
  const holder = entityElement({ id: 'crowd-holder' });
  return {
    layer: holder,
    async ready(w) { c = crowd(w, { template, network: () => net, around: () => [w.camera.lon, w.camera.lat], count: 40, figures: 10, radius: 70, seed: 3 }); w.add(c.element); await c.start(); },
  };
}
const L = lineup({}), LP = lineup({ parity: true }), LM = lineup({ moving: true }), LF = lineup({ at: FACES, only: ['grandmother', 'boy', 'office-worker', 'father'] }), W = walkers();
export const PEOPLE_PRESETS: Record<string, Preset> = {
  people: { title: 'people: a lineup of the ready-made humans', view: ALL.view, body: () => plane({ size: 120, grid: 2 }), layers: () => [L.layer], ready: L.ready },
  'people-faces': { title: 'people close: faces, hair, clothes', view: FACES.view, body: () => plane({ size: 120, grid: 2 }), layers: () => [LF.layer], ready: LF.ready },
  'people-walk': { title: 'people walking in place', view: ALL.view, body: () => plane({ size: 120, grid: 2 }), layers: () => [LM.layer], ready: LM.ready },
  crowd: { title: 'a crowd of people from seeds walking paths', view: { lon: 0, lat: 0, dist: 60, tilt: 62, bearing: 20 }, body: () => plane({ size: 200, grid: 20 }), layers: () => [W.layer], ready: W.ready },
  'parity-people': { title: 'parity: the lineup (no network)', deterministic: true, view: ALL.view, body: () => plane({ size: 120, grid: 2 }), layers: () => [LP.layer], ready: LP.ready },
};
