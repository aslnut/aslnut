// core › entities on the CPU: places and the things in them; walking, driving and flying bodies moved by what their
// drive wants; a wall stops a walker (it slides along); a person's controller reads the keys and the stick.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { entity, surface, air, controllers, drive, still, EntityElement, follow } from '../src/core/entities/index.ts';

const flat = { heightAt: () => 10, exaggeration: 1 };
const L = 145.12, B = -37.92;

test('entities: a place holds the things on its footprint; a thing knows its place', () => {
  const layer = new EntityElement();
  const park = entity({ id: 'park', kind: 'park', placement: 'place', at: [L, B], footprint: [[L - 0.001, B - 0.001], [L + 0.001, B - 0.001], [L + 0.001, B + 0.001], [L - 0.001, B + 0.001]] });
  const bench = entity({ id: 'b1', kind: 'bench', at: [L, B] }), far = entity({ id: 'b2', kind: 'bench', at: [L + 0.01, B] }), lamp = entity({ id: 'l1', kind: 'lamp', at: [L + 0.0005, B] });
  layer.add(park, bench, far, lamp);
  assert.equal(bench.in, park); assert.equal(far.in, null);
  assert.deepEqual(park.contents().map((e) => e.id).sort(), ['b1', 'l1']);
  assert.deepEqual(park.contents({ kind: 'bench' }).map((e) => e.id), ['b1']);
});

test('locomotion: a walker walks where it looks, stops at a wall and slides along it; jumps and lands', () => {
  const me = entity({ id: 'me', at: [L, B, 10], locomotion: surface({ speed: 2 }) });
  for (let i = 0; i < 60; i++) me.locomotion.step(me, { ...still(), forward: 1 }, 1 / 30, flat, 0);
  assert.ok(me.at[1] > B + 0.00002, 'north'); assert.ok(Math.abs(me.at[0] - L) < 1e-7);
  assert.ok(Math.abs(me.speed - 2) < 0.1, `speed ${me.speed}`);
  // a wall 3 m east: walking north-east it keeps going north
  const wall = (lon: number) => (lon > L + 3 / (111320 * Math.cos(B * Math.PI / 180)) ? 8 : 0);
  const w2 = entity({ id: 'w2', at: [L, B, 10], locomotion: surface({ speed: 2, blocked: (lon) => wall(lon) }) });
  for (let i = 0; i < 120; i++) w2.locomotion.step(w2, { ...still(), forward: 1, right: 1 }, 1 / 30, flat, 0);
  const east = (w2.at[0] - L) * 111320 * Math.cos(B * Math.PI / 180);
  assert.ok(east <= 3.05 && east > 2, `stopped at the wall: ${east}`); assert.ok(w2.at[1] > B + 0.00002, 'slid north');
  const j = entity({ id: 'j', at: [L, B, 10], locomotion: surface() }); j.locomotion.step(j, { ...still(), jump: true }, 1 / 30, flat, 0);
  assert.ok(j.at[2] > 10 && !j.onGround); for (let i = 0; i < 60; i++) j.locomotion.step(j, still(), 1 / 30, flat, 0); assert.equal(j.at[2], 10); assert.ok(j.onGround);
});

test('locomotion: a car speeds up, steers by speed; a drone climbs and holds its height over the ground', () => {
  const car = entity({ id: 'car', at: [L, B, 10], locomotion: surface({ wheels: { top: 50 } }) });
  for (let i = 0; i < 300; i++) car.locomotion.step(car, { ...still(), forward: 1, right: i > 150 ? 1 : 0 }, 1 / 30, flat, 0);
  assert.ok(car.speed > 10 && car.speed <= 50 / 3.6 + 0.01, `${car.speed}`); assert.ok(car.heading > 20, `turned ${car.heading}`);
  const dr = entity({ id: 'd', at: [L, B, 35], locomotion: air({ ceiling: 120 }) });
  for (let i = 0; i < 900; i++) dr.locomotion.step(dr, { ...still(), up: 1 }, 1 / 30, flat, 0);
  assert.equal(dr.altitude, 120); assert.equal(dr.at[2], 130);
});

test('controllers: the keys and the stick become what is wanted; a script drives', () => {
  const i = { keys: new Set(['KeyW', 'ShiftLeft']), stick: [0.5, 0] as [number, number], up: 0 };
  const w = controllers.walk().read(i); assert.equal(w.forward, 1); assert.equal(w.right, 0.5); assert.equal(w.fast, true);
  const f = controllers.fly().read({ keys: new Set(['KeyE']), stick: [0, 0], up: 0 }); assert.equal(f.up, 1);
  const d = drive.script(() => ({ forward: 0.5 })); assert.equal(d.want(entity({ id: 'x', at: [L, B] }), i, 0.1).forward, 0.5);
  assert.equal(drive.player(controllers.ride()).kind, 'player');
});

test('locomotion on a network keeps to its lines; inside an area it stops at the edge; follow and control are there', async () => {
  const { network } = await import('../src/index.ts');
  const net = network({ lines: [{ line: [[L - 0.001, B], [L + 0.001, B]] }] });
  const onNet = entity({ id: 'n', at: [L, B + 0.0001, 10], locomotion: surface({ on: net, speed: 2 }) });
  for (let i = 0; i < 30; i++) onNet.locomotion.step(onNet, { ...still(), forward: 1, right: 1 }, 1 / 30, flat, 0);
  assert.ok(Math.abs(onNet.at[1] - B) < 1e-7, 'snapped onto the line');
  const ring: [number, number][] = [[L - 0.0001, B - 0.0001], [L + 0.0001, B - 0.0001], [L + 0.0001, B + 0.0001], [L - 0.0001, B + 0.0001]];
  const inArea = entity({ id: 'a', at: [L, B, 10], locomotion: surface({ on: ring, speed: 2 }) });
  for (let i = 0; i < 300; i++) inArea.locomotion.step(inArea, { ...still(), forward: 1 }, 1 / 30, flat, 0);
  assert.ok(inArea.at[1] <= B + 0.0001, 'held inside');
  const { followEntity, control } = await import('../src/index.ts');
  assert.equal(typeof followEntity, 'function'); assert.equal(typeof control, 'function');
});

test('air: over the sea it keeps its height as the ground rises and falls under it, never under 2 m over it', () => {
  // a hill 300 m high under a plane flying north at 300 m over the sea
  const hill = { heightAt: (_lon: number, lat: number) => (lat > B + 0.002 && lat < B + 0.004 ? 300 : 20), exaggeration: 1 };
  const p = entity({ id: 'p', at: [L, B, 300], locomotion: air({ over: 'sea', hover: false, glide: 1, speed: 360 }) }); p.altitude = 300;
  const seen: number[] = [];
  for (let i = 0; i < 360; i++) { p.locomotion.step(p, still(), 1 / 30, hill, 0); seen.push(p.at[2]); }
  assert.ok(p.at[1] > B + 0.004, 'over the hill and past it');
  assert.ok(Math.max(...seen) <= 302.01 && Math.min(...seen) >= 299.99, `its height over the sea kept, the hill under it: ${Math.min(...seen).toFixed(2)} … ${Math.max(...seen).toFixed(2)}`);
  const low = entity({ id: 'q', at: [L, B, 30], locomotion: air({ over: 'sea', hover: false, glide: 1, speed: 360 }) }); low.altitude = 30;
  let top = 0; for (let i = 0; i < 360; i++) { low.locomotion.step(low, still(), 1 / 30, hill, 0); if (low.at[1] > B + 0.0025 && low.at[1] < B + 0.0035) top = Math.max(top, low.at[2]); }
  assert.ok(Math.abs(top - 302) < 1e-6, `lifted over the hill, 2 m over it: ${top}`);
  assert.ok(Math.abs(low.at[2] - 302) < 1e-6, 'and it keeps that height over the sea past it (it climbed: nothing brings it down)');
});

test('air: a drone hovers in place; a bird (hover: false) keeps flying', () => {
  const d = entity({ id: 'd2', at: [L, B, 35], locomotion: air() }), bird = entity({ id: 'b', at: [L, B, 35], locomotion: air({ hover: false, glide: 0.5 }) });
  for (let i = 0; i < 60; i++) { d.locomotion.step(d, still(), 1 / 30, flat, 0); bird.locomotion.step(bird, still(), 1 / 30, flat, 0); }
  assert.ok(Math.abs(d.at[1] - B) < 1e-9); assert.ok(bird.at[1] > B + 0.00005, 'flew on north');
});

test('collision: what stands in the way, from your polygons or the world\'s solids; a radius; low things stepped over', async () => {
  const { collision } = await import('../src/kits/game/collision.ts');
  const d = 0.0001, sq = (h: number, x: number) => ({ id: `b${x}`, props: { height: h }, geometry: { type: 'Polygon', coordinates: [[[L + x, B], [L + x + d, B], [L + x + d, B + d], [L + x, B + d], [L + x, B]]] } });
  const fake = { elementsOfKind: () => [] } as never;
  const c = collision(fake, { solids: [sq(8, 0), sq(0.2, 0.001)] as never, radius: 0.3 });
  assert.equal(c(L + d / 2, B + d / 2), 8, 'inside a building');
  assert.equal(c(L + d + 0.2 / 88000, B + d / 2), 8, 'within the radius of its wall');
  assert.equal(c(L + d * 3, B + d / 2), 0, 'open ground');
  assert.equal(c(L + 0.001 + d / 2, B + d / 2), 0, 'a kerb-high thing is stepped over');
  const compiled = collision({ elementsOfKind: () => [{ blockerAt: (lon: number) => (lon > L ? 5 : 0) }] } as never, { radius: 0 });
  assert.equal(compiled(L + 0.00001, B), 5); assert.equal(compiled(L - 0.00001, B), 0);
});

test('follow: entity headings become clockwise camera bearings', () => {
  let frame: (() => void) | undefined;
  let bearing = NaN;
  const w = { ...flat, camera: { frameK: 1 }, on: (_event: string, fn: (ev: { dt: number }) => void) => { frame = () => fn({ dt: 16 }); return () => {}; }, go: (v: { bearing: number }) => { bearing = v.bearing; } };
  const e = entity({ id: 'east', at: [L, B, 10], heading: 90 });
  follow(w as never, e); frame!();
  assert.equal(bearing, 90);
  follow(w as never, e, { yaw: () => Math.PI * 1.5 }); frame!();
  assert.equal(bearing, 270);
});
