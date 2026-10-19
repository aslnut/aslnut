// core › geometry › import › gltf: a model's triangles placed by its nodes, coloured by its materials, scaled to a
// length with its foot at 0; its paint (the colour over most of it) takes each instance's colour, the rest keep theirs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { importShape } from '../src/core/geometry/import/gltf.ts';
import { SHAPE_FLOATS, OWN_COLOUR } from '../src/core/geometry/shapes/mesh.ts';

/** a .glb: a big red triangle (its node raised 1 and scaled 2) and a small blue one */
function glb(): ArrayBuffer {
  const pos = new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0.1, 0, 0, 0, 0.1, 0]);
  const json = {
    asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0, 1] }],
    nodes: [{ mesh: 0, translation: [0, 1, 0], scale: [2, 2, 2] }, { mesh: 1 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, material: 0 }] }, { primitives: [{ attributes: { POSITION: 1 }, material: 1 }] }],
    materials: [{ pbrMetallicRoughness: { baseColorFactor: [1, 0, 0, 1] } }, { pbrMetallicRoughness: { baseColorFactor: [0, 0, 1, 1] } }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' }, { bufferView: 0, byteOffset: 36, componentType: 5126, count: 3, type: 'VEC3' }],
    bufferViews: [{ buffer: 0, byteLength: pos.byteLength }], buffers: [{ byteLength: pos.byteLength }],
  };
  let j = new TextEncoder().encode(JSON.stringify(json)); const pad = (4 - (j.length % 4)) % 4; const jj = new Uint8Array(j.length + pad).fill(32); jj.set(j); j = jj;
  const out = new Uint8Array(12 + 8 + j.length + 8 + pos.byteLength), dv = new DataView(out.buffer);
  out.set([0x67, 0x6c, 0x54, 0x46]); dv.setUint32(4, 2, true); dv.setUint32(8, out.length, true);
  dv.setUint32(12, j.length, true); dv.setUint32(16, 0x4e4f534a, true); out.set(j, 20);
  dv.setUint32(20 + j.length, pos.byteLength, true); dv.setUint32(24 + j.length, 0x004e4942, true); out.set(new Uint8Array(pos.buffer), 28 + j.length);
  return out.buffer;
}

test('import gltf: triangles placed by their nodes, scaled to a length, the foot at 0, the paint tinted', async () => {
  const m = await importShape('/model.glb', { length: 4, fetch: async () => glb() });
  const v = m.levels[0] as Float32Array, n = v.length / SHAPE_FLOATS;
  assert.equal(n, 6); assert.equal(m.triangles[0], 2);
  // the big one spans 2 m (scaled by its node), so the model is 2 m long: × 2 to 4 m
  const [lo, hi] = m.bounds;
  assert.ok(Math.abs(Math.max(hi[0] - lo[0], hi[2] - lo[2]) - 4) < 1e-6, `length ${JSON.stringify(m.bounds)}`);
  assert.equal(lo[1], 0);
  // the red one is the paint (most of the surface): white, taking the instance's colour; the blue keeps its own
  for (let i = 0; i < 3; i++) { assert.equal(v[i * SHAPE_FLOATS + 4], 0xffffff); assert.equal(v[i * SHAPE_FLOATS + 5], 0); }
  for (let i = 3; i < 6; i++) { assert.equal(v[i * SHAPE_FLOATS + 4], 0x0000ff); assert.equal(v[i * SHAPE_FLOATS + 5], OWN_COLOUR); }
  // the big one is lifted 1 by its node over the small one (at the foot): × 2 to the length, 2 m
  assert.ok(v[3 * SHAPE_FLOATS + 1]! < 1e-6 && Math.abs(v[1]! - 2) < 1e-6, `heights ${v[1]} ${v[3 * SHAPE_FLOATS + 1]}`);
  // its own colours kept: paint false
  const own = await importShape('/model.glb', { paint: false, fetch: async () => glb() });
  assert.equal((own.levels[0] as Float32Array)[4], 0xff0000);
});
