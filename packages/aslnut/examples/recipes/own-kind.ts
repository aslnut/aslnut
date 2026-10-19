// Your own design for a kind: a cottage that carries the house kind's traits (a roof, an entry at its front, parking
// outside, a service point), checked at every param's ends and placed on plots from data; and a model from a file
// made a house with its anchors (shapes.import), checked the same way. What uses a house reads only these traits.
import { color, data, earth, entities, imagery, int, kinds, num, roofFaces, shape, shapes, terrain, traits, world, type V3 } from 'aslnut';

// your data: plots (points with a heading: the way the front faces, degrees from north; a width; levels), a model
const PLOTS = 'data/plots.geojson';
const MODEL = 'models/house.glb'; // a glTF house; its front faces +z

// the design: a box of `levels` floors under a gable roof, a door at its front (+z), the house's anchors
const cottage = shape({
  id: 'cottage', kind: kinds.house,
  params: { width: num(6, 16, 9), depth: num(6, 14, 8), levels: int(1, 3, 1), floor: num(2.7, 3.4, 3), wall: color('#ece6da'), roofing: color('#8a5a44') },
  build: (b, p) => {
    const H = p.levels * p.floor, front = p.depth / 2, up = (pts: V3[]) => pts.map(([x, y, z]) => [x, y + H, z] as V3);
    // the walls as a group named 'walls': the kind measures the footprint from them (whatever else stands beside)
    b.group('walls', (b) => b.solid('box', { size: [p.width, H, p.depth], at: [0, H / 2, 0], color: p.wall }));
    // the roof as a group named 'roof': the kind measures its surface and tilt from it
    const roof = roofFaces('gable', p.width + 0.6, p.depth + 0.6, { pitch: 30 });
    b.group('roof', (b) => b.mesh(up(roof.slopes), { color: p.roofing }));
    b.mesh(up(roof.ends), { color: p.wall });
    b.solid('box', { size: [1, 2.1, 0.12], at: [0, 1.05, front + 0.06], color: '#5a3f2b' });
    // the house's traits: an entry at the front on the ground, parking outside the walls, a service point (a charger)
    b.anchor('entry-1', [0, 0, front + 0.8], { kind: 'entry', heading: 180 });
    b.anchor('parking-1', [p.width / 2 + 1.8, 0, front + 3], { kind: 'parking', heading: 180 });
    b.anchor('service-1', [p.width / 2 + 0.3, 0, front - 1], { kind: 'service' });
  },
});
// every param's ends and choices built and checked against the house kind (each trait missing or misplaced said once)
const checked = cottage.check({ kind: 'house' });
if (!checked.ok) throw new Error(`cottage: ${checked.problems.join('; ')}`);

// a model from a file, made a house: its anchors from its bounds (metres in its frame: its foot at 0, its front +z)
const model = await shapes.import(MODEL, {
  kind: 'house', length: 10, paint: false, params: { levels: 1 },
  anchors: (m) => ({
    'entry-1': { at: [0, 0, m.bounds[1][2] + 0.8], kind: 'entry', heading: 180 },
    'parking-1': { at: [m.bounds[1][0] + 2, 0, m.bounds[1][2] + 3], kind: 'parking', heading: 180 },
    'service-1': { at: [m.bounds[1][0] + 0.3, 0, 0], kind: 'service' },
  }),
});
const modelCheck = kinds.house.check(model);
if (!modelCheck.ok) throw new Error(`model: ${modelCheck.problems.join('; ')}`);

const canvas = document.querySelector('canvas')!;
const w = await world(canvas, {
  body: earth({ imagery: [imagery.esri()], terrain: [terrain.mapzen()] }),
  view: { lon: 145.1212, lat: -37.9236, zoom: 19.2, tilt: 55, bearing: 0 },
});
w.add(
  // a cottage on each plot, its params from the plot's data, turned to face its street
  entities({ id: 'cottages', shape: cottage, data: data.geojson(PLOTS),
    params: (d) => ({ width: Number(d.props.width), levels: Number(d.props.levels) }), heading: (d) => Number(d.props.heading) }),
  // the model house, placed as it is at two points
  entities({ id: 'models', shape: model, heading: () => 180, data: [
    { id: 'm1', props: {}, geometry: { type: 'Point', coordinates: [145.1210, -37.9232] } },
    { id: 'm2', props: {}, geometry: { type: 'Point', coordinates: [145.1214, -37.9232] } },
  ] }),
);

// the traits as anything that uses a house reads them (any design of a house answers the same)
const t = traits(cottage.make({ levels: 2 }), 'house'), r = t.roof as { surface: number; tilt: number };
const note = Object.assign(document.createElement('div'), { textContent: `cottage: a house · roof ${r.surface.toFixed(0)} m² at ${r.tilt.toFixed(0)}° · ${(t.parking as unknown[]).length} parking · ${(t.entries as unknown[]).length} entry` });
Object.assign(note.style, { position: 'fixed', left: '8px', bottom: '28px', zIndex: '10', background: 'rgba(12,16,24,.82)', padding: '6px 9px', borderRadius: '8px' });
document.body.append(note);
