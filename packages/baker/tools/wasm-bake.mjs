// The baker as the browser would run it: the wasm32 build, one bundle in, the pack's files out (here from Node, to
// prove the build bakes; a later studio calls the same three exports from a worker).
//   cargo build --release --target wasm32-unknown-unknown --no-default-features
//   node packages/baker/tools/wasm-bake.mjs <roads input dir> <place> <out dir> [compare with this pack dir]
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';

const [DIR, PLACE, OUT, CMP] = process.argv.slice(2);
const wasmFile = join(import.meta.dirname, '..', '..', '..', 'target', 'wasm32-unknown-unknown', 'release', 'baker.wasm');
const parts = [['place', Buffer.from(PLACE)], ['roads', '.geojson'], ['ground.json', '.ground.json'], ['ground.f32', '.ground.f32'], ['paths', '.paths.geojson'], ['reserve', '.reserve.geojson'], ['water', '.water.geojson']]
  .map(([k, v]) => [k, Buffer.isBuffer(v) ? v : existsSync(join(DIR, PLACE + v)) ? readFileSync(join(DIR, PLACE + v)) : null]).filter(([, v]) => v);
const enc = new TextEncoder(), u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
const bundle = Buffer.concat([u32(parts.length), ...parts.flatMap(([k, v]) => [u32(enc.encode(k).length), Buffer.from(k), u32(v.length), v])]);
const t0 = performance.now();
const { instance } = await WebAssembly.instantiate(readFileSync(wasmFile), {});
const { memory, alloc, bake_bundle, out_len } = instance.exports;
const p = alloc(bundle.length);
new Uint8Array(memory.buffer, p, bundle.length).set(bundle);
const q = bake_bundle(p, bundle.length), n = out_len();
const out = Buffer.from(new Uint8Array(memory.buffer, q, n));
const ms = performance.now() - t0;
let i = 4, files = [];
for (let k = 0, m = out.readUInt32LE(0); k < m; k++) { const ln = out.readUInt32LE(i); i += 4; const name = out.subarray(i, i + ln).toString(); i += ln; const lb = out.readUInt32LE(i); i += 4; files.push([name, out.subarray(i, i + lb)]); i += lb; }
if (files.length === 1 && files[0][0] === 'error') { console.error(`wasm bake failed: ${files[0][1]}`); process.exit(1); }
let bytes = 0;
for (const [name, b] of files) { const f = join(OUT, PLACE, name); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, b); bytes += b.length; }
let same = null;
if (CMP) { same = files.filter(([name]) => name.endsWith('.json')).every(([name, b]) => existsSync(join(CMP, name)) && readFileSync(join(CMP, name)).equals(b)); }
console.log(JSON.stringify({ place: PLACE, files: files.length, bytes, ms: Math.round(ms), memoryMB: Math.round(memory.buffer.byteLength / 1e6), sameAsNative: same }));
