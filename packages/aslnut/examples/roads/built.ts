// The stage demo's looks for what stages 12–15 placed (the bake decides where, never how it looks): the street level's
// own buildings and trees (streets()), and here, with the public API, the furniture by kind, the plots' outlines and a
// red post where the bake left something out (pick it: which check, which source).
import { color, entities, line, num, Rows, shape, type CityExtra, type World } from '../../src/index.ts';

const pole = shape({ id: 'demo-pole', params: { height: num(5, 12, 9), lamp: num(0, 1, 0) }, budget: { whole: 120, simple: 30 }, simple: true, far: 'box',
  build: (b, p) => { b.solid('cylinder', { radius: 0.12, size: p.height, at: [0, p.height / 2, 0], color: '#6e6255', sides: 8, detail: 0 }); if (p.lamp > 0.5) b.solid('box', { size: [1.2, 0.15, 0.3], at: [0.5, p.height, 0], color: '#3b3f44', detail: 0 }); else b.solid('box', { size: [1.6, 0.12, 0.12], at: [0, p.height - 0.4, 0], color: '#5a4c3f', detail: 0 }); } });
const thing = shape({ id: 'demo-furniture', params: { w: num(0.2, 3, 0.6), h: num(0.3, 3, 1), d: num(0.2, 2, 0.6), tint: color('#5a6b4a') }, budget: { whole: 40, simple: 12 }, simple: true, far: 'box',
  build: (b, p) => { b.solid('box', { size: [p.w, p.h, p.d], at: [0, p.h / 2, 0], color: p.tint, detail: 0 }); } });
const shelter = shape({ id: 'demo-shelter', params: {}, budget: { whole: 80, simple: 20 }, simple: true, far: 'box',
  build: (b) => { b.copy((b) => b.solid('box', { size: [0.08, 2.4, 0.08], at: [1.4, 1.2, 0.6], color: '#8a9096', detail: 0 }), { mirror: 'x' }); b.solid('box', { size: [3.2, 0.1, 1.6], at: [0, 2.45, 0], color: '#3d6f8f', detail: 0 }); b.solid('box', { size: [2.6, 0.06, 0.4], at: [0, 0.45, 0.4], color: '#6b4b33', detail: 0 }); } });
const marker = shape({ id: 'demo-omitted', params: {}, budget: { whole: 60, simple: 20 }, simple: true, far: 'box',
  build: (b) => { b.solid('cylinder', { radius: 0.18, size: 3, at: [0, 1.5, 0], color: '#e5383b', sides: 6, detail: 0 }); b.solid('cone', { radius: 0.5, top: 0, size: 0.8, at: [0, 3.4, 0], color: '#e5383b', sides: 6, detail: 0 }); } });
// each kind's size and colour (a look, not the bake's)
const SIZE: Record<string, [number, number, number, string]> = {
  bench: [1.8, 0.8, 0.6, '#7a5634'], bin: [0.6, 1, 0.6, '#3f5a3c'], 'bicycle-parking': [2, 0.8, 0.1, '#8a9096'], 'post-box': [0.5, 1.2, 0.5, '#c0392b'],
  'drinking-water': [0.4, 1, 0.4, '#5d7f99'], barbecue: [1.2, 0.9, 0.7, '#6c6c6c'], telephone: [0.9, 2.2, 0.9, '#b8b8b8'], vending: [1, 1.9, 0.8, '#9b2d2d'],
  'picnic-table': [2, 0.75, 1.6, '#7a5634'], bollard: [0.18, 0.9, 0.18, '#d4b13a'], hydrant: [0.3, 0.7, 0.3, '#c0392b'],
};
type Built = { key: string; extra: CityExtra | undefined; ctx: { lonLat(x: number, z: number): [number, number] } }[];
export function builtLayers(w: World, o: { plots: boolean; omitted: boolean }) {
  const poles = new Rows<Record<string, unknown>>([], { id: 'id' }), things = new Rows<Record<string, unknown>>([], { id: 'id' }), shelters = new Rows<Record<string, unknown>>([], { id: 'id' }), gone = new Rows<Record<string, unknown>>([], { id: 'id' }), lots = new Rows<Record<string, unknown>>([], { id: 'id' });
  const say = (d: { props: Record<string, unknown> }) => `${d.props.kind} · ${d.props.id}${d.props.patched ? ` · ${d.props.patched}` : ''} · OpenStreetMap (ODbL)`;
  const layers = [
    entities({ id: 'built-poles', shape: pole, data: poles, params: (d) => ({ lamp: d.props.kind === 'lamp' ? 1 : 0, height: d.props.kind === 'lamp' ? 7 : 9 }), when: { level: { from: 'street' } }, tooltip: say }),
    entities({ id: 'built-furniture', shape: thing, data: things, params: (d) => { const s = SIZE[String(d.props.kind)] ?? [0.6, 1, 0.6, '#777777']; return { w: s[0], h: s[1], d: s[2], tint: s[3] }; }, when: { level: { from: 'street' } }, tooltip: say }),
    entities({ id: 'built-shelters', shape: shelter, data: shelters, when: { level: { from: 'street' } }, tooltip: say }),
    ...(o.omitted ? [entities({ id: 'built-omitted', shape: marker, data: gone, when: { level: { from: 'street' } }, tooltip: (d) => `omitted ${d.props.what}: ${d.props.check} · ${d.props.id}` })] : []),
    ...(o.plots ? [line({ id: 'built-plots', data: lots, width: 1.2, color: '#f4e285', pickable: false, when: { level: { from: 'street' } } })] : []),
  ];
  const update = (built: Built) => {
    const P: unknown[] = [], T: unknown[] = [], S: unknown[] = [], G: unknown[] = [], L: unknown[] = [];
    const pt = (id: string, ll: [number, number], props: Record<string, unknown>) => ({ type: 'Feature', id, geometry: { type: 'Point', coordinates: ll }, properties: props });
    for (const t of built) {
      const e = t.extra; if (!e) continue;
      for (const f of e.furniture ?? []) { const row = pt(`${t.key}:${f.id}`, t.ctx.lonLat(f.x, f.z), { kind: f.kind, id: f.id, patched: f.patched }); (f.kind === 'pole' || f.kind === 'lamp' ? P : f.kind === 'bus-stop' ? S : T).push(row); }
      for (const m of e.omitted ?? []) G.push(pt(`${t.key}:gone:${m.id}:${m.what}`, t.ctx.lonLat(m.x, m.z), { what: m.what, check: m.check, id: m.id }));
      for (const l of e.lots ?? []) L.push({ type: 'Feature', id: `${t.key}:lot:${l.building}`, geometry: { type: 'LineString', coordinates: [...l.ring, l.ring[0]!].map(([x, z]) => t.ctx.lonLat(x, z)) }, properties: {} });
    }
    const fc = (features: unknown[]) => ({ type: 'FeatureCollection', features }) as never;
    poles.set(fc(P)); things.set(fc(T)); shelters.set(fc(S)); gone.set(fc(G)); lots.set(fc(L));
  };
  void w;
  return { layers, update };
}
