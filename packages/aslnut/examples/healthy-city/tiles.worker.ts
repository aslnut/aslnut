// The street level's tiles, the baked roads' meshes and the ground under the roads made off the main thread (one lane
// for all): the same look as the page's (its houses and trees), so the frames keep coming while a tile is made.
import { serve } from '../../src/core/runtime/workers.ts';
import { CITY, streetsWorker } from '../../src/modules/world/earth/street.ts';
import { bakedRoadsWorker } from '../../src/modules/world/earth/presets/built/roads/baked.ts';
import { house } from './houses.ts';
import { MELBOURNE_TREES } from './trees.ts';

// the page's look: no procedural poles, no bins (main.ts LOOK)
serve({ ...streetsWorker({ trees: MELBOURNE_TREES, houses: house, lot: { ...CITY.lot, bins: { ...CITY.lot.bins, chance: 0 } }, poles: { ...CITY.poles, chance: 0 } }), ...bakedRoadsWorker() });
