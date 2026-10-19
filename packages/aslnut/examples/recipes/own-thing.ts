// Your own thing: a watermill built from the builder's verbs, with three levels (the whole, a simpler one, its own far
// symbol), a wheel that turns by a joint driven by a rate, smoke from its chimney (copies over time, looping on the
// chip), and 240 mills that all look different with no build of their own: each clone is a record (its walls' and
// roof's colours, its size, its heading, its wheel's speed). One mill's wheel stops with one write.
import { earth, entities, imagery, num, roofFaces, shape, terrain, world, type V3 } from 'aslnut';

// the design, in metres in its own frame: its foot at y 0, its front +z
const mill = shape({
  id: 'mill',
  // params change its geometry (each distinct set is one build, cached); what only changes a look varies per clone
  params: { width: num(6, 12, 8), depth: num(6, 10, 7), wheel: num(2, 3.5, 2.8) },
  build: (b, p) => {
    const H = 5, front = p.depth / 2, up = (pts: V3[]) => pts.map(([x, y, z]) => [x, y + H, z] as V3);
    // the walls take each clone's colour (tint: true); the roof is a group: each clone can give it a colour of its own
    b.solid('box', { size: [p.width, H, p.depth], at: [0, H / 2, 0], color: '#e8e2d4', tint: true });
    const roof = roofFaces('gable', p.width + 0.6, p.depth + 0.6, { pitch: 35 });
    b.group('roof', (b) => b.mesh(up(roof.slopes), { color: '#7a4a36' }));
    b.mesh(up(roof.ends), { color: '#e8e2d4', tint: true });
    b.solid('box', { size: [1.2, 2.2, 0.1], at: [0, 1.1, front + 0.05], color: '#4a3524', detail: 1 }); // the door: whole and simple only
    // the chimney, and smoke from its top: copies over time (24 near, 8 at the simple level, none far)
    const top: V3 = [p.width / 4, H + 4.5, -p.depth / 4];
    b.solid('box', { size: [0.8, 4.5, 0.8], at: [top[0], H + 2.25, top[2]], color: '#8d877d' });
    b.frame({ at: top }, (b) => b.copy((b) => b.mesh([[-0.4, 0, 0], [0.4, 0, 0], [0, 0.7, 0]], { color: '#efefec' }),
      { emit: { count: [24, 8, 0], life: 4, rise: 12, spread: 2, grow: 2.5, fade: [0.7, 0], drift: [3, 1] } }));
    // the wheel on its side: a part that can turn round x at its hub (nothing turns it until the layer gives a driver);
    // eight paddles, copied round the hub, show it turning
    const hub: V3 = [p.width / 2 + 0.5, p.wheel, 0];
    b.part('wheel', (b) => {
      b.solid('cylinder', { radius: p.wheel * 0.8, size: 0.3, axis: 'x', at: hub, color: '#5b4632' });
      b.copy((b) => b.solid('box', { size: [0.6, 0.9, 0.12], at: [hub[0], hub[1] + p.wheel - 0.45, hub[2]], color: '#6b5640' }), { repeat: 8, turn: 45, axis: 'x', at: hub });
    }, { pivot: hub, joint: { kind: 'hinge', axis: 'x' } });
  },
  simple: true,                                                                         // level 1: the same build, fewer sides, no whole-only pieces
  far: (b, p) => b.solid('box', { size: [p.width, 7, p.depth], at: [0, 3.5, 0], color: '#e8e2d4', tint: true }), // level 2: its own symbol
  size: { min: 4 },                                                                     // never less than 4 CSS px across
});

// your data: the mills (points); here 240 made in code on a spiral round a place (about 440 m across)
const AT: [number, number] = [145.1215, -37.9235];
const mills = Array.from({ length: 240 }, (_, i) => {
  const r = 14 * Math.sqrt(i + 1), a = i * 2.39996, x = r * Math.cos(a), y = r * Math.sin(a);
  return { id: `m${i}`, props: { n: i, rpm: 2 + (i % 6) }, geometry: { type: 'Point' as const, coordinates: [AT[0] + x / (111320 * Math.cos((AT[1] * Math.PI) / 180)), AT[1] + y / 110574] as [number, number] } };
});
const WALLS = ['#e8e2d4', '#d9c9a8', '#c9d3d9', '#e3d0c4'], ROOFS = ['#7a4a36', '#4f5a62', '#8a6a3a'];
const n = (d: { props: Record<string, unknown> }) => Number(d.props.n);

const canvas = document.querySelector('canvas')!;
const w = await world(canvas, {
  body: earth({ imagery: [imagery.esri()], terrain: [terrain.mapzen()] }),
  view: { lon: AT[0], lat: AT[1] - 0.0002, zoom: 19.4, tilt: 64, bearing: 20 },
});

const valley = entities({
  id: 'mills', shape: mill, data: mills,
  params: (d) => ({ width: 6 + (n(d) % 3) * 2 }),                         // three widths: three builds for 240 clones
  variation: { seed: (d) => String(d.id), color: 0.06, scale: 0.12 },       // a seeded spread round each colour and size
  tint: (d) => WALLS[n(d) % 4]!,                                          // its walls' colour
  tints: { roof: (d) => ROOFS[(n(d) >> 2) % 3] },                          // its roof's colour
  heading: (d) => (n(d) * 47) % 360,
  joints: { wheel: (d) => ({ rate: Number(d.props.rpm), unit: 'rpm' }) }, // the chip turns each wheel from the clock
  pixels: { full: 90, simple: 20, margin: 0.2 },                           // each clone's level by its size on screen (CSS px)
});
w.add(valley);
valley.joint('m0', 'wheel', { rate: 0 });                                  // one write: the first mill's wheel stops
