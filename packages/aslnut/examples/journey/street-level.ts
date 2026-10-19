// Kuta's street level, as the twin's is loaded (examples/healthy-city/street-level.ts): the place's baked roads
// (footpaths, crossings), its tiles of buildings and trees placed against them by the bake's stages 12–15
// (tools/journey-data.mjs: OpenStreetMap's, © OpenStreetMap contributors), the ground under them (the open terrain tiles,
// buildings taken out, fitted to the coastline: the sand rising from the sea) and the look: the trees as Kuta's are
// (palms, and broad round crowns), no procedural poles or bins (no open data for them here).
import { CITY, SPECIES, clampTerrain, streetsWorker, terrain, worker, type TreeLook } from '../../src/index.ts';

export const PACK = '/aslnut/data/packs/journey', KUTA = `${PACK}/kuta`, KUTA_TILES = `${KUTA}/built/index.json`;
/** Kuta's ground: its grid blended in, clamped to the baked roads */
export const kutaGround = () => clampTerrain(terrain.grid({ url: `${PACK}/kuta.ground`, blend: 60, attribution: 'Terrain: Mapzen terrain tiles (AWS Open Data), buildings taken out, fitted to the coastline' }), `${KUTA}/clamp.json`);
/** the trees of Kuta's streets and gardens: palms most, round broadleaf crowns between them */
export const KUTA_TREES: TreeLook = { variants: 2, species: { palm: { weight: 3, spec: SPECIES.palm.spec }, tree: { weight: 2, spec: SPECIES.tree.spec } } };
export const LOOK = { trees: KUTA_TREES, lot: { ...CITY.lot, bins: { ...CITY.lot.bins, chance: 0 } }, poles: { ...CITY.poles, chance: 0 } };
/** the workers that build the street level's tiles (the page builds them itself where workers are not there) */
export const kutaWorkers = (count?: number) => worker(() => new Worker(new URL('./tiles.worker.ts', import.meta.url), { type: 'module' }), { fallback: streetsWorker(LOOK), count });
