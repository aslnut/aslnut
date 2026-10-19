// The twin's place: Clayton, Melbourne, at the street level. Its ground is the terrain lowered under its roads (the
// clamp), its roads the baked ones (tools › compile, the street place), its street tiles the plots, houses, buildings,
// trees and furniture placed by the bake's gated stages 12–15, its water the lakes and creeks (Vicmap Hydro) and the
// sea. The layers example builds the same place from here (on street-level.ts: the packs, the ground, the look, the
// workers the healthy-city example and the fleet load too).
//   const twin = clayton({ street: { tooltip } }); w.add(twin.water, twin.roads, twin.street, twin.street.wires)
import { bakedRoads, data, streets, water, type StreetsProps, type View, type WorkerLane } from '../../src/index.ts';
import { LOOK, ROADS, STREET_TILES, streetGround, streetWorkers } from './street-level.ts';

export { LOOK, ROADS, STREET_TILES, streetGround };
/** the city pack (councils, suburbs, open space, buildings, water) and the street place's pack */
export const PACK = '/aslnut/data/packs/city';
/** the street level's middle, tilted */
export const CLAYTON: View = { lon: 145.1205, lat: -37.9245, zoom: 17.6, tilt: 66, bearing: 330 };
/** the place the street level covers [w, s, e, n] */
export const STREET_BOX: [number, number, number, number] = [145.09, -37.95, 145.16, -37.9];
/** the workers that build its tiles and its roads (the same look); `count` how many (default the device's) */
export const tileLane = (count?: number) => streetWorkers(count);

export interface ClaytonOptions {
  /** the street tiles' own options over these (hover, selection, tooltips, a tile's callback) */
  street?: Partial<StreetsProps>;
  /** build the tiles and the roads in workers (default true; false: on the page) and how many */
  workers?: boolean | number;
  /** the lane to build them in (one the page made already: its ground's, streetGround(lane)); over `workers` */
  lane?: WorkerLane;
  /** what the street level builds itself (default all but its water: water() draws it) */
  kinds?: (kind: string) => boolean;
}
/** the twin's parts: its roads, its street tiles (and their wires), its water, each a layer of its own (a layer list
 *  switches them one by one) */
export function clayton(o: ClaytonOptions = {}) {
  const lane = o.lane ?? (o.workers === false ? undefined : tileLane(typeof o.workers === 'number' ? o.workers : undefined));
  const roads = bakedRoads({ label: 'roads', url: `${ROADS}/index.json`, near: 3500, worker: lane, when: { level: { from: 'street' } }, tooltip: (d) => `${d.props.name ?? d.props.what ?? d.kind}${d.props.highway ? ` · ${d.props.highway}` : ''}` });
  // zoomed out over the street level (a tree a few pixels across), the trees are counted: a number per 250 m square
  // instead of every tree (core › geometry › shapes › levels › counted)
  const street = streets({ label: 'street level', url: STREET_TILES, near: 3500, look: LOOK, counted: { cell: 250, level: 'street', size: 11, color: '#e8f5d0' }, worker: lane, when: { level: { from: 'street' } },
    tooltip: (d) => `${d.props.name ?? d.props.kind ?? d.kind}${d.props['height (m)'] ? ` · ${d.props['height (m)']} m` : ''}`, ...o.street });
  // the water: lakes and creeks (Vicmap Hydro) and the sea (Port Phillip Bay over the terrain's seafloor), drawn by
  // aslnut's water() in place of the street level's own
  const waterSrc = data.geojson(`${PACK}/water.geojson`, { attribution: '© State of Victoria (Vicmap Hydro), CC BY 4.0' });
  const waterL = water({ id: 'water', label: 'water', lakes: waterSrc, rivers: waterSrc, sea: true, tooltip: (d) => `${d.props.name ?? 'water'}${d.props['width (m)'] ? ` · ${d.props['width (m)']} m wide` : ''}` });
  const kinds = o.kinds ?? ((k: string) => k !== 'water' && k !== 'waterway');
  street.setView(kinds);
  return { roads, street, water: waterL, lane, kinds };
}
