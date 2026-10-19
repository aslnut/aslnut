// The bake's stages 12–15 (plots, buildings on pads, trees, furniture): their mechanisms and gates on a small made-up
// place: a road along x with kerbs, nature strips and footpaths in a 20 m reserve, houses beside it, trees and poles.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Exclusion, nudge, overlapWith } from '../src/core/geometry/landform/compose/exclusion.ts';
import { gradePads } from '../src/core/geometry/landform/compose/foundation.ts';
import { fitBehind, splitPlots, type P2 } from '../src/core/geometry/zones/rules/frontage.ts';
import { BakeGateError } from '../src/core/runtime/workers/compile/gates.ts';
import { DEFAULT_PATCHES } from '../src/core/runtime/workers/compile/patch-policy.ts';
import type { Piece } from '../src/core/geometry/networks/bake-types.ts';
import type { StageGate } from '../src/core/runtime/workers/compile/patch-policy.ts';
import { bakeBuilt, type BuiltOptions } from '../src/modules/world/earth/presets/built/buildings/compile.ts';
import { builtTiles, decodeBuiltTile } from '../src/modules/world/earth/presets/built/buildings/tiles.ts';
import type { BuiltInputs } from '../src/modules/world/earth/presets/built/buildings/inputs.ts';

const rect = (x0: number, z0: number, x1: number, z1: number): P2[] => [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
const path = (r: P2[]) => r.map(([x, y]) => ({ x, y }));
const area = (kind: string, r: P2[], h = 10): Piece => ({ t: 'area', kind, rings: [r.map(([x, z]) => [x, z, h] as [number, number, number])], info: 0 });
// the reserve: z −10..10; carriageway |z| < 4, kerbs 4..4.3, nature strips 4.3..7, footpaths 7..9 (both sides)
const pieces: Piece[] = [area('carriageway', rect(-200, -4, 200, 4)), area('verge', rect(-200, 4.3, 200, 7)), area('verge', rect(-200, -7, 200, -4.3)), area('footpath', rect(-200, 7, 200, 9)), area('footpath', rect(-200, -9, 200, -7)),
  { t: 'edge', kind: 'kerb', pts: [[-200, 4, 10, 10, 0, 0.3], [200, 4, 10, 10, 0, 0.3]].map(([x, z, h, g, dx, dz]) => [x!, z! + dz!, h!, g!, 0, -dz!]) as never, info: 0 }];
const reserve = [path(rect(-200, -10, 200, 10))];
const ground = (slope = 0.05) => { const nx = 120, nz = 40, data = new Float32Array(nx * nz); for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) data[j * nx + i] = 10 + Math.max(0, (j * 4 - 80) - 12) * slope; return { x0: -240, z0: -80, step: 4, nx, nz, data }; };
const inputs = (o: Partial<BuiltInputs> = {}): BuiltInputs => ({ buildings: [], trees: [], furniture: [], roads: [], parks: [], water: [], streams: [], sources: {}, attribution: '', ...o });
const house = (id: string, r: P2[], cls = 'house') => ({ id, ring: r, height: 6, heightFrom: 2, cls, seed: 1 });
const run = (inp: BuiltInputs, options: BuiltOptions = {}, slope = 0.05) => { const stages: StageGate[] = []; const clamp = { cells: [], edges: [], terrain: ground(slope) }; return { r: bakeBuilt({ pieces, reserve, clamp, inputs: inp, stages, options }), stages, clamp }; };

test('exclusion: layers, overlap, clip and nudge', () => {
  const ex = new Exclusion({ road: [path(rect(0, 0, 10, 10))], verge: [path(rect(10, 0, 12, 10))] });
  assert.deepEqual(ex.at(5, 5), ['road']);
  assert.equal(Math.round(ex.overlap(rect(5, 5, 15, 15), ['road'])), 25);
  assert.equal(Math.round(overlapWith(rect(0, 0, 4, 4), [rect(2, 2, 6, 6)])), 4);
  const n = nudge(9.5, 5, (x, z) => ex.has('verge', x, z), { limit: 2 });
  assert.ok(n && n.moved <= 1.01 && ex.has('verge', n.at[0], n.at[1]));
  assert.equal(nudge(2, 5, (x, z) => ex.has('verge', x, z), { limit: 2 }), null);
});

test('frontage: clip under 15 %, else set back up to 3 m, else omit', () => {
  const ex = new Exclusion({ r: reserve }), inside = { overlap: (r: readonly P2[]) => ex.overlap(r, ['r']), clip: (r: readonly P2[]) => ex.clip(r, ['r']) };
  assert.equal(fitBehind(rect(0, 12, 10, 22), inside).how, 'clear');
  const clipped = fitBehind(rect(0, 9, 10, 19), inside); assert.equal(clipped.how, 'footprint-clip'); assert.ok(Math.abs(clipped.clippedM2 - 10) < 0.1);
  const back = fitBehind(rect(0, 8, 10, 14), inside); assert.equal(back.how, 'setback'); assert.ok(back.moved >= 2 && back.moved <= 3);
  assert.equal(fitBehind(rect(0, 2, 10, 12), inside).how, 'omit');
});

test('plots: overlapping neighbours split along their bisector', () => {
  const plots = [{ ring: rect(0, 10, 12, 30), middle: [4, 20] as P2 }, { ring: rect(8, 10, 20, 30), middle: [16, 20] as P2 }];
  const s = splitPlots(plots); assert.equal(s.pairs, 1);
  assert.ok(overlapWith(plots[0]!.ring, [plots[1]!.ring]) < 0.5);
});

test('pads: the ground cut to the floor, no buried wall, the skirt under the lowest ground; kept ground raises the floor', () => {
  const g = ground(0.3), at = (x: number, z: number) => { const fx = (x - g.x0) / g.step, fz = (z - g.z0) / g.step, i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j, d = g.data; return (d[j * g.nx + i]! * (1 - u) + d[j * g.nx + i + 1]! * u) * (1 - v) + (d[(j + 1) * g.nx + i]! * (1 - u) + d[(j + 1) * g.nx + i + 1]! * u) * v; };
  const [p] = gradePads([{ ring: rect(0, 14, 12, 26) }], g, at);
  assert.ok(p!.cutM > 0 && p!.buriedM === 0 && p!.high <= p!.pad + 1e-6 && p!.bottom < p!.low);
  const g2 = ground(0.3), at2 = (x: number, z: number) => { const fx = (x - g2.x0) / g2.step, fz = (z - g2.z0) / g2.step, i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j, d = g2.data; return (d[j * g2.nx + i]! * (1 - u) + d[j * g2.nx + i + 1]! * u) * (1 - v) + (d[(j + 1) * g2.nx + i]! * (1 - u) + d[(j + 1) * g2.nx + i + 1]! * u) * v; };
  const [q] = gradePads([{ ring: rect(0, 14, 12, 26) }], g2, at2, { keep: () => true });
  assert.ok(q!.cutM === 0 && q!.buriedM > 0 && q!.raisedM > 0 && q!.high <= q!.pad);
});

test('stages 12–15: gates pass, every patch recorded on the gate and on the piece', () => {
  const inp = inputs({
    buildings: [house('clear', rect(0, 14, 10, 24)), house('clip', rect(20, 9.2, 30, 19.2)), house('setback', rect(40, 8.5, 48, 14.5)), house('on-road', rect(60, -2, 70, 12)), house('dup', rect(1, 15, 9, 23), 'garage')],
    trees: [{ id: 't-ok', x: 5, z: 5.5, height: 8, crown: 3, seed: 1 }, { id: 't-road', x: 15, z: 3.8, height: 8, crown: 3, seed: 2 }, { id: 't-mid', x: 30, z: 0, height: 8, crown: 3, seed: 3 }, { id: 't-house', x: 5, z: 18, height: 8, crown: 3, seed: 4 }],
    furniture: [{ id: 'node/1', x: 12, z: 3.5, tags: { power: 'pole' } }, { id: 'node/2', x: 14, z: 8, tags: { amenity: 'bench' } }, { id: 'node/3', x: 16, z: 0, tags: { highway: 'bus_stop' } }],
  });
  const { r, stages } = run(inp);
  assert.deepEqual(stages.map((g) => [g.stage, g.ok]), [[12, true], [13, true], [14, true], [15, true]]);
  const by = new Map(r.buildings.map((b) => [b.id, b]));
  assert.ok(by.get('clear') && !by.get('clear')!.patches.some((p) => p.check === 'building-reserve'));
  assert.equal(by.get('clip')!.patches[0]!.algorithm, 'footprint-clip');
  assert.equal(by.get('setback')!.patches.find((p) => p.check === 'building-reserve')!.algorithm, 'setback');
  assert.ok(!by.has('on-road') && r.omitted.some((o) => o.id === 'on-road' && o.check === 'building-reserve'));
  assert.ok(!by.has('dup') || by.get('dup')!.patches.some((p) => p.check === 'building-overlap'));
  for (const b of r.buildings) assert.ok(b.pad && b.pad.high <= b.pad.pad + 1e-6 && b.pad.bottom < b.pad.low, `pad of ${b.id}`);
  const trees = new Map(r.trees.map((t) => [t.id, t]));
  assert.equal(trees.get('t-ok')!.patches.length, 0);
  assert.equal(trees.get('t-road')!.patches[0]!.algorithm, 'nudge'); assert.ok(trees.get('t-road')!.z > 4.3);
  assert.ok(!trees.has('t-mid') && !trees.has('t-house'));
  assert.ok(r.furniture.some((f) => f.id === 'node/2' && !f.patches.length));
  assert.ok(!r.furniture.some((f) => f.id === 'node/3'));
  const g13 = stages.find((g) => g.stage === 13)!;
  assert.ok(g13.patches!.some((p) => p.algorithm === 'setback' && p.ids.includes('setback')));
  assert.equal(g13.checks!.find((c) => c.check === 'building-reserve')!.policy, 'repair');
  assert.equal(DEFAULT_PATCHES['building-reserve'].fallback, 'omit');
  // the placement tiles carry the pads, the patches and the omissions, and decode back
  const t = builtTiles({ placement: r, ground: inp, origin: [145, -38], bbox: [0, 0, 0, 0], attribution: '', sources: {}, gates: stages });
  const tile = decodeBuiltTile(structuredClone([...t.tiles.values()][0]!)) as { buildings: number[][]; pads: number[]; patches: number[][]; omitted: number[][]; s: string[] };
  assert.equal(tile.pads.length, 2 * tile.buildings.length);
  assert.ok(tile.patches.some((p) => tile.s[p[2]!]!.startsWith('patched: setback')));
  assert.ok(tile.omitted.some((o) => tile.s[o[3]!] === 'building-reserve'));
});

test('stages 12–15: policies are per check (omit, stop)', () => {
  const inp = inputs({ buildings: [house('clip', rect(20, 9.2, 30, 19.2))], trees: [{ id: 't-road', x: 15, z: 3.8, height: 8, crown: 3, seed: 2 }] });
  const omitTrees = run(inp, { patch: { 'tree-collision': 'omit' } }).r;
  assert.equal(omitTrees.trees.length, 0); assert.ok(omitTrees.omitted.some((o) => o.id === 't-road'));
  assert.throws(() => run(inp, { patch: { 'building-reserve': 'stop' } }), (e) => e instanceof BakeGateError && e.gate.stage === 13);
  assert.throws(() => run(inp, { patch: { 'tree-collision': () => 'stop' } }), (e) => e instanceof BakeGateError && e.gate.stage === 14);
});

test('frontage: an outline too big for a house is not one (no plot, no front fence); a foundation shows at most 1 m to the street', () => {
  // a block of units under one 'house' outline, 45 m along the street; a house up a slope from the street
  const inp = inputs({ buildings: [house('units', rect(0, 14, 45, 30)), house('up', rect(60, 13, 72, 25))] });
  const { r, stages } = run(inp, {}, 0.6);
  assert.deepEqual(stages.map((g) => [g.stage, g.ok]), [[12, true], [13, true], [14, true], [15, true]]);
  const by = new Map(r.buildings.map((b) => [b.id, b])), units = by.get('units')!, up = by.get('up')!;
  assert.equal(units.house, false); assert.equal(units.plot, null);
  assert.ok(units.patches.some((p) => p.check === 'house-size' && p.algorithm === 'not-a-house'));
  assert.equal(stages[0]!.counts.housesTooBig, 1);
  assert.ok(up.house && up.plot && up.pad);
  assert.ok(up.pad!.frontM <= 1.02 && up.pad!.loweredM > 0 && up.pad!.high <= up.pad!.pad + 1e-6, `front ${up.pad!.frontM}`);
  assert.ok(up.patches.some((p) => p.check === 'pad-front' && p.algorithm === 'set-into-slope'));
  assert.ok(stages[1]!.patches!.some((p) => p.check === 'pad-front' && p.ids.includes('up')));
  // the tile says which are houses (the drawing follows the bake, not the label)
  const t = builtTiles({ placement: r, ground: inp, origin: [145, -38], bbox: [0, 0, 0, 0], attribution: '', sources: {}, gates: stages });
  const tile = decodeBuiltTile(structuredClone([...t.tiles.values()][0]!)) as { buildings: number[][]; homes: number[] };
  assert.equal(tile.homes.length, tile.buildings.length); assert.deepEqual([...tile.homes].sort(), [0, 1]);
  // policies: stop on either fails its stage; without the repair the foundation stands over 1 m to the street
  assert.throws(() => run(inp, { patch: { 'house-size': 'stop' } }, 0.6), (e) => e instanceof BakeGateError && e.gate.stage === 12);
  assert.throws(() => run(inp, { patch: { 'pad-front': 'stop' } }, 0.6), (e) => e instanceof BakeGateError && e.gate.stage === 13);
  assert.equal(DEFAULT_PATCHES['pad-front'].policy, 'repair'); assert.equal(DEFAULT_PATCHES['house-size'].algorithm, 'not-a-house');
});
