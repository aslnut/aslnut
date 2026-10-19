// Bake a tileset's pyramid into its archive, from the command line (build time; CI):
//   node packages/server/bake.ts world 0 6        → <data>/packs/tiles/world.pmtiles
import { bakeArchive } from './tiles.ts';

const [id = 'world', min = '0', max = '99'] = process.argv.slice(2);   // default: the set's whole archive plan
let last = 0;
const r = await bakeArchive(id, +min, +max, (d, t) => { if (performance.now() - last > 1000 || d === t) { last = performance.now(); console.log(`${id}: ${d} / ${t}`); } });
console.log(`${id} z${min}–${max}: ${r.tiles} tiles, ${(r.bytes / 1024 / 1024).toFixed(2)} MB, ${(r.ms / 1000).toFixed(1)} s → ${r.file}`);
