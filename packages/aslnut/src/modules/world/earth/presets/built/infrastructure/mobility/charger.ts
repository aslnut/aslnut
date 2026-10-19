// modules › world › earth › presets › built › infrastructure › mobility › charger: a place to charge electric vehicles,
// built with the shape builder. A station: a canopy on posts over a row of pedestals (each with its screen, its cable
// on a hook and a status light), the bays in front of them marked on the ground, and a tall sign with a plug. A wall
// charger (a house's, an office car park's): a box with a screen and a light on a short post. Its ports (bays), power,
// bay width and canopy are params; whole, simple and box levels as the car's. Anchors: `bay-1…` where a car stands to
// charge (facing the pedestal) and `light-1…` each port's status light (a drawing of its state goes there: free,
// charging). Its front (+z) faces the road; the bays lie on that side.
//   entities({ id: 'stations', shape: charger, data: stations, params: (d) => ({ ports: d.props.bays }), heading: (d) => d.props.heading })
import { shape, num, int, choice, flag, color } from '../../../../../../../core/geometry/shapes/shape.ts';
import type { Builder, V3 } from '../../../../../../../core/geometry/shapes/builder.ts';
import { kinds } from '../../../../../../../core/entities/kinds.ts';

const STEEL = '#c9ced4', DARK = '#23272c', SCREEN = '#0f1b26', WHITE = '#f4f5f2', CABLE = '#18191b', ASPHALT = '#3b3e42';

export const charger = shape({
  id: 'charger', kind: kinds.charger,
  params: {
    /** ports: bays and pedestals side by side (a wall charger: its ports on one box) */
    ports: int(1, 8, 4),
    /** kW: a fast one's pedestal stands taller, its screen larger */
    power: choice(['7', '22', '50', '150'], '50'),
    /** a station's canopy over its pedestals and bays */
    canopy: flag(true),
    /** a station's pedestals, or a wall charger on a short post (a house's, a car park's) */
    mount: choice(['pedestal', 'wall'], 'pedestal'),
    /** a bay's width, m */
    bay: num(2.3, 3.4, 2.7),
    /** its plug (a standard's name: data the kind carries) */
    connector: choice(['ccs2', 'type2', 'chademo', 'ccs1', 'j1772', 'gbt'], 'ccs2'),
    /** a brand's colour: the canopy's fascia, the sign, the pedestals' band (default a neutral grey) */
    brand: color('#8d9298'),
    /** the pedestals' and the wall boxes' body */
    body: color(WHITE),
    /** the canopy's slab */
    canopyColor: color('#e9ecef'),
    /** the bays' surface (white lines at their sides) */
    marking: color('#c4c8cc'),
    /** a station's tall sign with a plug on it */
    sign: flag(true),
    /** its bays marked on the ground (green, white lines at their sides: a car park's, a station's; a house's
     *  driveway has none) */
    marked: flag(true),
  },
  budget: { whole: 3600, simple: 1500 },
  simple: true, far: 'box',
  build: (b: Builder, p) => {
    const n = p.ports, bay = p.bay, fast = Number(p.power) >= 50, wall = p.mount === 'wall';
    const box = (size: V3, at: V3, f: object = {}) => b.solid('box', { size, at, ...f });
    const xs = Array.from({ length: n }, (_, i) => (i - (n - 1) / 2) * bay);
    if (wall) {
      // a wall charger: a post, the box on it (a screen, a light), its cable on a hook; one bay in front, marked
      for (const [i, x] of xs.entries()) {
        box([0.12, 1.25, 0.12], [x, 0.62, -0.18], { color: STEEL, material: 'metal' });
        box([0.38, 0.48, 0.16], [x, 1.3, -0.08], { color: p.body, round: 0.03 });
        box([0.2, 0.14, 0.02], [x, 1.36, 0.01], { color: SCREEN, material: 'glass', detail: 1 });
        box([0.08, 0.05, 0.03], [x, 1.5, 0.01], { color: '#34d399', material: 'glass' });
        box([0.04, 0.5, 0.04], [x + 0.15, 1.0, 0.0], { color: CABLE, detail: 0 });
        box([0.12, 0.04, 0.12], [x + 0.15, 0.76, 0.03], { color: CABLE, detail: 0 });
        // its bay marked in front (its surface, white lines at its sides)
        if (p.marked) {
          box([bay - 0.2, 0.02, 5], [x, 0.01, 2.9], { color: p.marking, detail: 1 });
          for (const sx of [-1, 1]) box([0.1, 0.025, 5], [x + (sx * bay) / 2, 0.012, 2.9], { color: WHITE, detail: 1 });
        }
        b.anchor(`light-${i + 1}`, [x, 1.5, 0.03], { kind: 'light' });
        b.anchor(`bay-${i + 1}`, [x, 0, 2.9], { kind: 'parking', heading: 180 });
      }
      return;
    }
    // the bays: a surface each, white lines between (only near: detail 1)
    const depth = 5.4, z0 = 0.5, z1 = z0 + depth, w = n * bay;
    for (const [i, x] of xs.entries()) {
      if (p.marked) box([bay - 0.2, 0.02, depth], [x, 0.01, (z0 + z1) / 2], { color: p.marking, detail: 1 });
      b.anchor(`bay-${i + 1}`, [x, 0, z0 + depth / 2 + 0.2], { kind: 'parking', heading: 180 });
    }
    if (p.marked) for (let i = 0; i <= n; i++) box([0.12, 0.025, depth], [(i - n / 2) * bay, 0.012, (z0 + z1) / 2], { color: WHITE, detail: 1 });
    // a kerb island under the pedestals
    box([w + 0.6, 0.15, 1.1], [0, 0.075, -0.15], { color: '#b7bbbf' });
    // the pedestals: a body (taller when fast), a screen, the brand's band, a light on top, the cable on its hook
    const ph = fast ? 1.9 : 1.4;
    for (const [i, x] of xs.entries()) {
      box([0.62, ph, 0.42], [x, 0.15 + ph / 2, -0.15], { color: p.body, round: 0.04 });
      box([0.64, 0.16, 0.44], [x, 0.15 + ph * 0.18, -0.15], { color: p.brand });
      box([0.44, fast ? 0.42 : 0.3, 0.02], [x, 0.15 + ph * 0.72, 0.07], { color: SCREEN, material: 'glass' });
      box([0.3, 0.06, 0.06], [x, 0.15 + ph + 0.03, 0.0], { color: '#34d399', material: 'glass' });
      b.anchor(`light-${i + 1}`, [x, 0.15 + ph + 0.06, 0.0], { kind: 'light' });
      // the cable: down from its socket, a loop, up to the hook
      box([0.05, ph * 0.5, 0.05], [x + 0.36, 0.15 + ph * 0.42, -0.02], { color: CABLE, detail: 0 });
      box([0.05, 0.05, 0.3], [x + 0.36, 0.15 + ph * 0.17, 0.12], { color: CABLE, detail: 0 });
      box([0.1, 0.14, 0.08], [x + 0.36, 0.15 + ph * 0.67, 0.04], { color: DARK, detail: 0 });
    }
    // the canopy: posts at its corners, a slab over the pedestals and the bays, its fascia in the brand's colour
    if (p.canopy) {
      const ch = 4.6, cz0 = -1.4, cz1 = z1 - 0.6, cw = w + 1.2;
      for (const sx of [-1, 1]) for (const z of [cz0 + 0.3, cz1 - 0.3]) b.solid('cylinder', { radius: 0.14, size: ch, at: [sx * (cw / 2 - 0.3), ch / 2, z], color: STEEL, material: 'metal', sides: 10 });
      box([cw, 0.32, cz1 - cz0], [0, ch + 0.16, (cz0 + cz1) / 2], { color: p.canopyColor });
      box([cw + 0.04, 0.42, 0.06], [0, ch + 0.12, cz1 + 0.01], { color: p.brand });
      box([cw + 0.04, 0.42, 0.06], [0, ch + 0.12, cz0 - 0.01], { color: p.brand, detail: 1 });
      // its lights under the slab (they light up from dusk)
      for (const x of xs) box([0.9, 0.04, 0.2], [x, ch - 0.02, (z0 + z1) / 2], { color: '#fff7e0', lamps: 'windows', detail: 1 });
    }
    // the sign: a tall post at one end, a panel in the brand's colour, a plug on it (a socket's face, two pins, its cable)
    if (p.sign) {
      const sx = w / 2 + 1.4, sh = 6.2;
      box([0.22, sh, 0.22], [sx, sh / 2, 0.2], { color: STEEL, material: 'metal' });
      box([1.3, 1.3, 0.16], [sx, sh + 0.5, 0.2], { color: p.brand, round: 0.05 });
      for (const f of [1, -1]) {
        const zf = 0.2 + f * 0.09;
        b.solid('cylinder', { radius: 0.36, size: 0.02, axis: 'z', at: [sx, sh + 0.55, zf], color: WHITE, sides: 18, detail: 1 });
        for (const dx of [-0.12, 0.12]) box([0.07, 0.18, 0.03], [sx + dx, sh + 0.6, zf + f * 0.01], { color: p.brand, detail: 1 });
        box([0.08, 0.22, 0.03], [sx, sh + 0.3, zf + f * 0.01], { color: WHITE, detail: 1 });
      }
    }
    // a flat apron of asphalt under it all (the far box reads its colour)
    box([w + 3.6, 0.01, depth + 3], [0.6, 0.004, (z0 + z1) / 2 - 0.6], { color: ASPHALT, detail: 1 });
  },
});
/** chargers: made by params (a station, a wall charger), the shape */
export const chargers = {
  make: (p: Parameters<typeof charger.make>[0] = {}, seed = 1) => charger.make(p, seed),
  /** a canopied station of `ports` fast pedestals */
  station: (ports = 4) => charger.make({ ports, power: '50', canopy: true, mount: 'pedestal' }),
  /** a wall charger (a car park's: its bays marked; a house's: `marked` false) */
  wall: (ports = 1, marked = true) => charger.make({ ports, power: '7', canopy: false, mount: 'wall', sign: false, marked }),
  shape: charger,
};
