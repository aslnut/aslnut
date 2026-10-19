// core › space › stands: where something stands is the top of what is drawn there. On a made-up baked road tile (a
// road under a deck, a kerb, a footpath): the levels found are the drawn faces that look up, the undersides left out;
// the level picked is the one nearest the height it had (under the deck stays under, on it stays on), the road and not
// the ground under it, the ground where nothing is drawn or under a deck high enough (for one that was down there); a road high over the
// ground (a fill) is stood on all the same; a walker on its own network and a
// person walking with the keys stand on it; a world without such a layer answers the ground, as before.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { standGrid, standOn } from '../src/core/space/stands.ts';
import { bakedMesh, bakedStands, BAKED_LOOK, type BakedTile } from '../src/modules/world/earth/presets/built/roads/baked.ts';
import { MESH_FLOATS } from '../src/core/geometry/shapes/mesh.ts';
import { entity, surface, groundOf, still, type GroundWorld } from '../src/core/entities/index.ts';
import { network } from '../src/core/geometry/networks/index.ts';
import { walker } from '../src/modules/presets/shared/locomotion/walker.ts';

const KINDS = ['carriageway', 'footpath', 'kerb', 'deck-under', 'marking'];
// an area piece: [4, kind, info, down, rings, n, x z h …] (a square from (x0, z0) to (x1, z1) at height h)
const area = (k: number, x0: number, z0: number, x1: number, z1: number, h: number, down = 0) => [4, k, 0, down, 1, 4, x0, z0, h, x1, z0, h, x1, z1, h, x0, z1, h];
// a kerb along x = 20 (z 0 … 40), its top reaching 0.45 m east: [5, kind, info, n, (x z h ground dx dz) …]
const kerb = [5, 2, 0, 2, 20, 0, 10, 9.7, 0.45, 0, 20, 40, 10, 9.7, 0.45, 0];
const TILE: BakedTile = { v: 3, ix: 0, iz: 0, size: 100, infos: [{ kind: 'road', props: {} }], pieces: [
  area(0, 0, 0, 20, 40, 10),                     // the road, 10 m
  area(1, 20.45, 0, 24, 40, 10.18),              // the footpath beyond the kerb
  area(0, 5, 10, 15, 20, 16),                    // a deck over the road (6 m)
  area(3, 5, 10, 15, 20, 15.4, 1),               // its underside (looks down: not stood on)
  area(0, 40, 10, 50, 20, 16),                   // a deck over bare ground
  kerb,
] };
const GROUND = 9.7;   // the ground, pushed under the road

test('stands: the levels found are the drawn faces looking up (the undersides left out), at their heights', () => {
  const g = standGrid(bakedStands(TILE, KINDS)), at = (x: number, z: number) => { const o: number[] = []; g.levelsAt(x, z, o); return o.sort((a, b) => a - b); };
  assert.deepEqual(at(2, 2).map((h) => +h.toFixed(3)), [10]);
  assert.deepEqual(at(10, 15).map((h) => +h.toFixed(3)), [10, 16], 'the road and the deck over it; not its underside');
  assert.deepEqual(at(20.2, 30).map((h) => +h.toFixed(3)), [10.15], "the kerb's top");
  assert.deepEqual(at(22, 30).map((h) => +h.toFixed(3)), [10.18], 'the footpath');
  assert.deepEqual(at(60, 60), [], 'nothing drawn');
  // the same as the mesh drawn: every face that looks up has its level among them
  const m = bakedMesh(TILE, KINDS, BAKED_LOOK).mesh, F = MESH_FLOATS;
  for (const [x, z] of [[2, 2], [10, 15], [20.2, 30], [22, 30], [45, 15]] as const) {
    const drawn: number[] = [];
    for (let i = 0; i < m.length; i += 3 * F) {
      const ax = m[i]!, ay = m[i + 1]!, az = m[i + 2]!, ux = m[i + F]! - ax, uy = m[i + F + 1]! - ay, uz = m[i + F + 2]! - az, vx = m[i + 2 * F]! - ax, vy = m[i + 2 * F + 1]! - ay, vz = m[i + 2 * F + 2]! - az, d = ux * vz - uz * vx;
      if (uz * vx - ux * vz < 0.7 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) || !d) continue;
      const s = ((x - ax) * vz - (z - az) * vx) / d, t = ((z - az) * ux - (x - ax) * uz) / d;
      if (s >= -1e-6 && t >= -1e-6 && s + t <= 1 + 1e-6) drawn.push(ay + s * uy + t * vy);
    }
    for (const h of drawn) assert.ok(at(x, z).some((l) => Math.abs(l - h) < 0.005), `(${x}, ${z}): drawn ${h.toFixed(3)} found in ${at(x, z)}`);
  }
});

test('stands: the level nearest the height it had: under a deck stays under, on it stays on; the road, not the ground under it', () => {
  const lv = [10, 16];
  assert.equal(standOn(lv, GROUND), 10, 'put down: on the road (not on the deck, not on the ground under the road)');
  assert.equal(standOn(lv, GROUND, 10.1), 10, 'under the deck: stays under');
  assert.equal(standOn(lv, GROUND, 15.8), 16, 'on the deck: stays on');
  assert.equal(standOn([16], GROUND, 9.8), GROUND, 'a deck over bare ground: under it, on the ground, when it was down there');
  assert.equal(standOn([16], GROUND, 16.2), 16, '… or on it, when it was up there');
  assert.equal(standOn([11.2], GROUND), 11.2, 'put down: on the road however far the ground lies under it (a fill)');
  assert.equal(standOn([11.2], GROUND, 10), 11.2, '… and kept there (the ground under a road is not stood on)');
  assert.equal(standOn([10.1], GROUND, 12), 10.1, 'the ground under a road is never stood on');
  assert.equal(standOn([], GROUND, 30), GROUND, 'nothing drawn: the ground');
  assert.ok(Number.isNaN(standOn([], NaN)), 'nothing known: NaN');
  assert.equal(standOn([10, 16], NaN), 10, 'the ground not known yet: the lowest drawn');
  assert.equal(standOn([10, 16], NaN, 16.1), 16, '… or the nearest');
});

// a world of the tile: x east, z south metres from (0, 0) as lon / lat by one scale
const S = 1e-5, xz = (lon: number, lat: number) => [lon / S, -lat / S] as const;
function worldOf(stands: boolean): GroundWorld {
  const g = standGrid(bakedStands(TILE, KINDS)), out: number[] = [];
  return { heightAt: () => GROUND, exaggeration: 1, ...(stands ? { standAt: (lon: number, lat: number, near?: number) => { out.length = 0; const [x, z] = xz(lon, lat); g.levelsAt(x, z, out); return standOn(out, GROUND, near); } } : {}) };
}

test('stands: groundOf, surface() and the walker stand on what is drawn (the ground in a world without it)', () => {
  const w = worldOf(true), plain = worldOf(false);
  assert.equal(groundOf(plain, 10 * S, -15 * S), GROUND, 'no layer to stand on: the ground, as before');
  assert.equal(groundOf(w, 10 * S, -15 * S), 10);
  assert.equal(groundOf(w, 10 * S, -15 * S, 16.05), 16);
  // a person walks east along z = 15 under the deck: on the road all the way, up the kerb, onto the footpath
  const go = (at: [number, number, number]) => { const e = entity({ id: 'p', at, heading: 90, locomotion: surface({ speed: 1.4 }) }); return e; };
  const under = go([1 * S, -15 * S, 10]), on = go([6 * S, -15 * S, 16]);
  const hs: number[] = [], ho: number[] = [];
  for (let i = 0; i < 160; i++) { under.locomotion.step(under, { ...still(), forward: 1 }, 0.1, w, Math.PI / 2); hs.push(under.at[2]); }
  for (let i = 0; i < 40; i++) { on.locomotion.step(on, { ...still(), forward: 1 }, 0.1, w, Math.PI / 2); if (xz(on.at[0], on.at[1])[0] < 15) ho.push(on.at[2]); }
  const x = xz(under.at[0], under.at[1])[0];
  assert.ok(x > 20.5 && Math.abs(under.at[2] - 10.18) < 0.02, `walked onto the footpath: x ${x.toFixed(1)}, ${under.at[2].toFixed(3)} m`);
  assert.ok(hs.slice(0, 40).every((h) => Math.abs(h - 10) < 0.02), 'under the deck: on the road');
  assert.ok(ho.length > 5 && ho.every((h) => Math.abs(h - 16) < 0.02), `on the deck: on it (${ho.map((h) => h.toFixed(2))})`);
  // the walker on a network along z = 15: on the road under the deck
  const net = network({ lines: [{ line: [[1 * S, -15 * S], [18 * S, -15 * S]] }] }), e = entity({ id: 'w', at: [2 * S, -15 * S], locomotion: walker({ network: net, side: 0 }) });
  e.at[2] = NaN; for (let i = 0; i < 30; i++) { e.locomotion.step(e, { ...still(), forward: 1 }, 0.1, w, 0); assert.ok(Math.abs(e.at[2] - 10) < 0.02, `walker at ${e.at[2]}`); }
});
