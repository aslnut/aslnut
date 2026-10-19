// The library's ready-made things side by side on the street: every species of the tree library planted down the
// middle of the nearest street, each grown from its name (?go=trees); the car presets parked along it, a fleet of
// one build in many paints (tinted), the drones hovering over it (?go=vehicles, ?go=vehicles-dusk: their lamps lit);
// the camera looks down the street at them.
import { SPECIES, choice, entities, material, shape, vegetation, type Feature, type Element, type MaterialName, type RasterSource, type World } from '../../src/index.ts';
import { cars } from '../../src/modules/presets/vehicles/index.ts';
import { drones } from '../../src/modules/presets/drones/index.ts';

type LL = [number, number];
const D = Math.PI / 180;
/** places along a street from `at` (its middle, running `heading` degrees): `n` of them, by turns on its right and its
 *  left verge (`side` m out), a pair every `step` m from `from` m along */
export function avenue(at: LL, heading: number, n: number, step: number, side: number, from = 0): LL[] {
  const kx = 111320 * Math.cos(at[1] * D), e = Math.sin(heading * D), nn = Math.cos(heading * D);
  return Array.from({ length: n }, (_, i) => { const a = from + Math.floor(i / 2) * step, s = i % 2 ? -side : side; return [at[0] + (e * a + nn * s) / kx, at[1] + (nn * a - e * s) / 110574]; });
}
/** the camera `back` m behind `at`, `up` m up, looking along the street (`heading`) and down by 90° − tilt */
export function lookAlong(w: World, at: LL, heading: number, o: { back?: number; up?: number; tilt?: number } = {}): void {
  const back = o.back ?? 20, up = o.up ?? 12, tilt = o.tilt ?? 72, kx = 111320 * Math.cos(at[1] * D), e = Math.sin(heading * D), nn = Math.cos(heading * D);
  // the view's centre is where the camera's middle ray meets the ground
  const ahead = up * Math.tan(tilt * D) - back, dist = up / Math.cos(tilt * D);
  w.camera.minDist = 1;
  w.go({ lon: at[0] + (e * ahead) / kx, lat: at[1] + (nn * ahead) / 110574, dist: dist / w.camera.frameK, tilt, bearing: heading } as never);
}
/** the camera beside the street `along` m down it, `off` m to its right (negative: its left), `up` m up, looking
 *  across it */
export function lookAcross(w: World, at: LL, heading: number, along: number, o: { off?: number; up?: number; tilt?: number } = {}): void {
  const off = o.off ?? 9, up = o.up ?? 2.5, tilt = o.tilt ?? 80, kx = 111320 * Math.cos(at[1] * D), e = Math.sin(heading * D), nn = Math.cos(heading * D);
  // the camera's place, then the ground point its middle ray meets (towards the street's left)
  const cx = e * along + nn * off, cy = nn * along - e * off, ahead = up * Math.tan(tilt * D), b = heading + (off > 0 ? -90 : 90), be = Math.sin(b * D), bn = Math.cos(b * D);
  w.camera.minDist = 1;
  w.go({ lon: at[0] + (cx + be * ahead) / kx, lat: at[1] + (cy + bn * ahead) / 110574, dist: up / Math.cos(tilt * D) / w.camera.frameK, tilt, bearing: b } as never);
}
/** the tree library down the middle of a street: each species by name, at its own height (as grown), a pair every
 *  16 m either side of the centre line (apart from the street's own trees) */
export function speciesAvenue(at: LL, heading: number): { layer: Element; names: string[] } {
  // the smaller ones nearer the camera; the first pair 20 m down the street
  const names = Object.keys(SPECIES).sort((a, b) => SPECIES[a as keyof typeof SPECIES].spec.trunk.height - SPECIES[b as keyof typeof SPECIES].spec.trunk.height), places = avenue(at, heading, names.length, 16, 3.2, 20);
  const data = names.map((s, i) => ({ id: `species-${s}`, kind: 'tree', geometry: { type: 'Point', coordinates: places[i]! }, props: { species: s, height: SPECIES[s as keyof typeof SPECIES].spec.trunk.height * 1.15 } })) as unknown as Feature[];
  return { layer: vegetation({ id: 'species', data, species: (d: Feature) => String(d.props.species), height: (d: Feature) => Number(d.props.height), crown: () => null }), names };
}
/** this example's paint for each car preset */
const PRESET_PAINTS: Record<string, string> = { hatch: '#b8322a', sedan: '#2c5aa0', wagon: '#4a5a4f', pickup: '#e6e6e6', van: '#f2f2f2', bus: '#f2b705', truck: '#c43c2c' };
/** the car presets down the street (each its own build, parked on alternate sides, facing along it), a fleet of
 *  hatches in eight paints from one build (each instance tinted), and the drone presets hovering above */
export function vehicleAvenue(at: LL, heading: number): { layers: Element[]; names: string[] } {
  const names = Object.keys(cars.package.presets), places = avenue(at, heading, names.length, 14, 2.6, 18);
  const pt = (id: string, c: LL, props: Record<string, unknown>, h?: number) => ({ id, kind: 'vehicle', geometry: { type: 'Point', coordinates: h === undefined ? c : [c[0], c[1], h] }, props }) as unknown as Feature;
  const presetCars = names.map((n, i) => pt(`car-${n}`, places[i]!, { preset: n }));
  const paints = ['#b8322a', '#2c5aa0', '#e6e6e6', '#2f2f33', '#c9a227', '#3d6b4f', '#7a3e8c', '#d9772b'], fleetAt = avenue(at, heading, 8, 6, 6.2, 18 + 14 * Math.ceil(names.length / 2));
  const fleet = paints.map((c, i) => pt(`fleet-${i}`, fleetAt[i]!, { paint: c }));
  const dn = Object.keys(drones.package.presets), up = avenue(at, heading, dn.length, 10, 1.5, 22);
  const air = dn.map((n, i) => pt(`drone-${n}`, up[i]!, { preset: n }, 7 + i * 1.5));
  return {
    names: [...names, ...dn],
    layers: [
      // (each preset in this example's own paint: the presets themselves are neutral, white to grey)
      entities({ id: 'car-presets', shape: cars.shape, data: presetCars, params: (d) => ({ ...cars.package.presets[String(d.props.preset)], paint: PRESET_PAINTS[String(d.props.preset)], traffic: 'left' }), heading: () => heading }),
      // one build (white paint): each instance's tint is its paint
      entities({ id: 'car-fleet', shape: cars.shape, data: fleet, params: () => ({ type: 'hatch', paint: '#ffffff', traffic: 'left' }), tint: (d) => String(d.props.paint), heading: (d) => heading + (Number(String(d.id).slice(6)) % 2 ? 180 : 0) }),
      entities({ id: 'drones', shape: drones.shape, data: air, params: (d) => drones.package.presets[String(d.props.preset)]!, at: (d) => (d.geometry as unknown as { coordinates: [number, number, number] }).coordinates, heading: () => heading + 200 }),
    ],
  };
}
/** the materials side by side down the street: a ball on a plinth in each (pbr rough and metal), and three blocks: a
 *  facade (its windows drawn in the shader), glass with rooms behind it, a roof showing the imagery under it */
export const MATERIAL_KINDS = ['matte', 'painted', 'concrete', 'glass', 'metal', 'emissive', 'flat', 'pbr-rough', 'pbr-metal', 'facade', 'interior', 'imagery'] as const;
const sampler = shape({
  id: 'material-sampler',
  params: { kind: choice(MATERIAL_KINDS, 'matte') },
  build: (b, p) => {
    const k = p.kind, m = k === 'pbr-rough' ? material('pbr', { roughness: 0.9, metal: 0 }) : k === 'pbr-metal' ? material('pbr', { roughness: 0.25, metal: 1 }) : (k as MaterialName);
    const col = k === 'emissive' ? '#ffd27a' : k === 'pbr-metal' ? '#c9a24a' : k === 'glass' ? '#24323d' : k === 'flat' ? '#e0453a' : '#c8b8a0';
    if (k === 'facade' || k === 'interior' || k === 'imagery') { b.solid('box', { size: [6, 9.6, 6], at: [0, 4.8, 0], color: k === 'interior' ? '#22303a' : '#d9cfbf', material: m }); return; }
    b.solid('box', { size: [1.6, 0.5, 1.6], at: [0, 0.25, 0], color: '#8d8a84', material: 'concrete' });
    b.solid('sphere', { radius: 1.1, at: [0, 1.6, 0], color: col, material: m });
  },
});
export function materialsAvenue(at: LL, heading: number, imagery: RasterSource): { layer: Element; names: readonly string[] } {
  const places = avenue(at, heading, MATERIAL_KINDS.length, 9, 4.2, 14);
  const data = MATERIAL_KINDS.map((k, i) => ({ id: `material-${k}`, kind: 'material', geometry: { type: 'Point', coordinates: places[i]! }, props: { kind: k } })) as unknown as Feature[];
  return { layer: entities({ id: 'materials', shape: sampler, data, params: (d) => ({ kind: String(d.props.kind) }), heading: () => heading, imagery: { source: imagery, zoom: 17 }, windows: { lit: 0.6 } }), names: MATERIAL_KINDS };
}
