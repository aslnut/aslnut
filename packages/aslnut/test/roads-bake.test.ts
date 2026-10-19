// The roads bake (tools › compile › steps › solve): the polygon stage and the kerb on small made-up networks, no
// graphics. Each level's surface a valid set of simple polygons, no slivers, the kerb on the surface and never across
// a road, close junctions merged into one surface, a junction's corners rounded, a bridge its own level.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { solveRoads, type Ground } from '../tools/compile/steps/solve.ts';
import type { RoadWay } from '../src/core/geometry/networks/graph.ts';
import { network } from '../src/core/geometry/networks/index.ts';

const O: [number, number] = [145, -37.9];
const flat: Ground = { x0: -1000, z0: -1000, step: 50, nx: 41, nz: 41, data: new Float32Array(41 * 41).fill(20) };
// a way from points in metres (x east, z south) round the origin
const kx = 111320 * Math.cos((O[1] * Math.PI) / 180);
const way = (id: number, nodes: number[], pts: [number, number][], tags: Record<string, string>): RoadWay => ({ id, nodes, pts: pts.map(([x, z]) => [O[0] + x / kx, O[1] - z / 110574]), tags });
const clean = (r: ReturnType<typeof solveRoads>['report']) => {
  assert.equal(r.invalid, 0, 'outlines cross'); assert.equal(r.slivers, 0, 'slivers'); assert.equal(r.kerbOutside, 0, 'kerb off the surface');
  assert.equal(r.kerbCrossings, 0, 'kerb across a road'); assert.equal(r.zfight, 0, 'z-fighting');
};

test('roads bake: a crossroads is one surface with four rounded corners and a kerb round each block', () => {
  const ways = [
    way(1, [1, 2, 3], [[-120, 0], [0, 0], [120, 0]], { highway: 'secondary', name: 'East Road' }),
    way(2, [4, 2, 5], [[0, -120], [0, 0], [0, 120]], { highway: 'residential', name: 'North Street' }),
  ];
  const s = solveRoads(ways, O, flat);
  clean(s.report);
  assert.equal(s.report.levels, 1);
  assert.equal(s.report.area.length, 1);
  // the union and the corners: the two buffers (7.6 m and 7.3 m between kerbs, 0.45 m kerbs, round dead ends) and four
  // kerb returns of 7.5 m (the smaller road's): r² (1 − π/4) each
  const a = 3.8 + 0.45, b = 3.65 + 0.45, plain = 240 * 2 * a + 240 * 2 * b - 4 * a * b + Math.PI * (a * a + b * b), corners = 4 * 7.5 ** 2 * (1 - Math.PI / 4);
  assert.ok(Math.abs(s.report.area[0]! - plain - corners) < corners * 0.25, `area ${s.report.area[0]} vs ${plain.toFixed(0)} + ${corners.toFixed(0)}`);
  assert.ok(s.report.zones >= 1 && s.report.planar === s.report.zones);
  assert.ok(s.pieces.some((p) => p.t === 'area') && s.pieces.some((p) => p.t === 'edge' && p.kind === 'kerb'));
});

test('roads bake: two junctions 12 m apart merge by themselves; a bridge is its own level with parapets and piers', () => {
  const ways = [
    way(1, [1, 2, 3, 4], [[-150, 0], [0, 0], [12, 0], [150, 0]], { highway: 'primary', name: 'Main Road' }),
    way(2, [5, 2], [[0, -100], [0, 0]], { highway: 'residential', name: 'Side Street' }),
    way(3, [3, 6], [[12, 0], [12, 100]], { highway: 'residential', name: 'Other Street' }),
    // a bridge over the main road, landing well away from it
    way(4, [7, 8], [[80, -300], [80, -120]], { highway: 'secondary', name: 'Over Road' }),
    way(5, [8, 9], [[80, -120], [80, 120]], { highway: 'secondary', name: 'Over Road', bridge: 'yes', layer: '1' }),
    way(6, [9, 10], [[80, 120], [80, 300]], { highway: 'secondary', name: 'Over Road' }),
  ];
  const s = solveRoads(ways, O, flat);
  clean(s.report);
  assert.equal(s.report.levels, 2);
  assert.ok(s.report.clearance.least !== null && s.report.clearance.least >= 4.5, `clearance ${s.report.clearance.least}`);
  assert.ok(s.pieces.some((p) => p.t === 'edge' && p.kind === 'deck'), 'parapets');
  assert.ok(s.pieces.some((p) => p.t === 'box' && p.kind === 'pier'), 'piers');
  assert.ok(s.pieces.some((p) => p.t === 'area' && p.kind === 'deck-under'), 'a deck underside');
});

test('roads bake: a roundabout keeps its island; a local street has no lines', () => {
  const ring: [number, number][] = []; for (let i = 0; i <= 24; i++) { const a = (i / 24) * 2 * Math.PI; ring.push([Math.cos(a) * 20, Math.sin(a) * 20]); }
  const ways = [
    way(1, [...Array.from({ length: 24 }, (_, i) => 100 + i), 100], ring, { highway: 'tertiary', junction: 'roundabout' }),
    way(2, [1, 100], [[150, 0], [20, 0]], { highway: 'residential', name: 'Quiet Street' }),
    way(3, [2, 112], [[-150, 0], [-20, 0]], { highway: 'residential', name: 'Quiet Street' }),
  ];
  const s = solveRoads(ways, O, flat);
  clean(s.report);
  assert.equal(s.report.islands, 1);
  assert.ok(s.report.holes >= 1, 'the island is a hole in the surface');
  const quiet = s.infos.findIndex((i) => i.props.name === 'Quiet Street');
  assert.ok(!s.pieces.some((p) => p.kind === 'marking' && p.info === quiet), 'no lines on a local street');
});

test('roads bake: verges: footpaths from the data and along the property line, crossings with ramps, nature strips, none on the road', () => {
  const ways = [
    way(1, [1, 2, 3], [[-150, 0], [0, 0], [150, 0]], { highway: 'residential', name: 'East Street' }),
    way(2, [4, 2, 5], [[0, -150], [0, 0], [0, 150]], { highway: 'residential', name: 'North Street' }),
  ];
  // the reserves: 20 m wide along each street (their crossing the junction's square)
  const toLL = (x: number, z: number): [number, number] => [O[0] + x / kx, O[1] - z / 110574];
  const reserves = [[[-150, -10], [150, -10], [150, 10], [-150, 10], [-150, -10]], [[-10, -150], [10, -150], [10, 150], [-10, 150], [-10, -150]]].map((r) => r.map(([x, z]) => toLL(x!, z!)));
  // a mapped sidewalk along East Street's north side, 1.2 m wide
  const paths = [{ pts: [toLL(-140, -8), toLL(-10, -8)], tags: { highway: 'footway', footway: 'sidewalk', width: '1.2' } }];
  const s = solveRoads(ways, O, flat, { reserves, paths });
  clean(s.report);
  const r = s.report;
  assert.equal(r.reserveFrom, 'data');
  assert.equal(r.vergeOverlap, 0, 'footpath or strip on the road or on each other'); assert.equal(r.vergeSlivers, 0);
  assert.ok(r.footpathArea > 4 * 130 * 1.2 && r.vergeArea > 4 * 130 * 3, `footpaths ${r.footpathArea} m², strips ${r.vergeArea} m²`);
  // (four arms; one end where the mapped sidewalk stops short of the corner has no footpath to meet)
  assert.ok(r.crossings >= 3, `crossings ${r.crossings}`);
  assert.ok(s.pieces.some((p) => p.t === 'edge' && p.kind === 'ramp'), 'kerb ramps');
  assert.ok(s.walk.some((w) => w.kind === 'crossing') && s.walk.some((w) => w.kind === 'footpath'), 'the walking graph has crossings and the mapped footpath');
  // the walking graph joins: from the north-west block's corner to the south-east one's, across two crossings, a walk
  // not much longer than the way round the corner
  const net = network({ lines: s.walk.map((e) => ({ line: e.pts.map(([x, z]) => toLL(x, z)), props: { kind: e.kind } })), snap: 0.05 });
  const cost = net.shortest([{ at: toLL(-40, -9) }]).costAt(toLL(40, 9));
  assert.ok(Number.isFinite(cost) && cost < 80 + 18 + 30, `walk ${cost}`);
});

test('review: a path already behind the kerb does not grow perpendicular endpoint spurs',()=>{
  const road=way(1,[1,2],[[-100,0],[100,0]],{highway:'residential'});
  const toLL=(x:number,z:number):[number,number]=>[O[0]+x/kx,O[1]-z/110574];
  const s=solveRoads([road],O,flat,{paths:[{pts:[toLL(-60,-7),toLL(-20,-7)],tags:{highway:'footway',osm_id:'path-1'}}]});
  assert.equal(s.report.stages[8]!.counts.endpointLinks,0);
  for(const piece of s.pieces)if(piece.t==='area'&&piece.kind==='footpath')for(const p of piece.rings.flat())assert.ok(p[1]>=-8.5,`footpath protrudes beyond its reserve: ${p[1]}`);
});
