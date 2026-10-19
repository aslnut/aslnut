// The street level of this twin, as any example loads it: the street place's packs (its baked roads, footpaths,
// verges and crossings; its tiles of plots, buildings, trees), the ground under them (the terrain with the buildings
// taken out, clamped to the roads), the look (Melbourne's street trees, the houses of this twin; no procedural poles or
// bins: there is no open data for them here) and the workers that build its tiles and its roads off the main thread.
//   import { ROADS, STREET_TILES, streetGround, LOOK, streetWorkers } from '../healthy-city/street-level.ts'
import { bakedRoadsWorker, CITY, clampTerrain, streetsWorker, terrain, worker, type WorkerLane } from '../../src/index.ts';
import { house } from './houses.ts';
import { MELBOURNE_TREES } from './trees.ts';

export const ROADS = '/aslnut/data/packs/roads/street', STREET_TILES = `${ROADS}/built/index.json`;
/** the street place's ground: its terrain grid (buildings taken out) blended in, clamped to the baked roads (in the
 *  street level's lane when given: streetWorkers()) */
export const streetGround = (lane?: WorkerLane) => clampTerrain(terrain.grid({ url: `${ROADS}.ground`, blend: 60, attribution: 'Terrain: Mapzen terrain tiles (AWS Open Data), buildings taken out' }), `${ROADS}/clamp.json`, { worker: lane });
/** the look of what the street level builds (the same in its workers: tiles.worker.ts) */
export const LOOK = { trees: MELBOURNE_TREES, houses: house, lot: { ...CITY.lot, bins: { ...CITY.lot.bins, chance: 0 } }, poles: { ...CITY.poles, chance: 0 } };
/** the workers that build the street level's tiles and the baked roads' meshes and make the ground under the roads,
 *  one lane for all (the page does it itself where workers are not there) */
export const streetWorkers = (count?: number) => worker(() => new Worker(new URL('./tiles.worker.ts', import.meta.url), { type: 'module' }), { fallback: { ...streetsWorker(LOOK), ...bakedRoadsWorker() }, count });
