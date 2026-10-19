import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TileSet, STAND_UP, type Loaded } from '../src/modules/world/surface/tiles.ts';

test('tiles: stationary loading fills a larger window; motion restores the configured limit', async () => {
  const levels: number[] = [];
  const pending: ((r: Loaded | null) => void)[] = [];
  const tiles = new TileSet({ layers: 128, maxTiles: 100, inflight: 10, isMiss: () => false,
    load: (e) => { levels.push(e.z); return new Promise((ok) => pending.push(ok)); },
  });
  const want = Array.from({ length: 30 }, (_, i) => ({ z: 7, x: 64 + i, y: 64, c: i, d: i }));
  const centre = { lon: 0, lat: 0 };
  tiles.update(want, 'one', 0, centre, [], 16);
  assert.equal(pending.length, 16, 'the initial view starts more independent tile loads together');
  assert.equal(levels[0], 2, 'a coarse base always stands in');
  assert.ok(levels.slice(1).every((z) => z === 7), 'fine tiles take the remaining slots at startup');
  tiles.update(want, 'one', 16, centre, [], 10);
  assert.equal(pending.length, 16, 'motion starts no extra load while the larger window drains');
  for (const done of pending.splice(0)) done({ heights: null });
  // request completions pass through then + finally before another frame.
  await new Promise<void>((ok) => setImmediate(ok));
  tiles.update(want, 'one', 32, centre, [], 10);
  assert.equal(pending.length, 10, 'the smaller moving window applies to the next batch');
  tiles.dispose();
  for (const done of pending) done(null);
});

test('surface: a pool growth whose copy did not land keeps the pool as it was (its tiles still shown); one that lands grows it', async () => {
  const { Surface } = await import('../src/modules/world/surface/surface.ts');
  type Tex = { label: string; layers: number; destroyed: boolean; destroy(): void };
  let lands = false; const made: Tex[] = [], copies: [string, number, number][] = [];
  const texture = (d: { label: string; layers: number }): Tex => { const t: Tex = { label: d.label, layers: d.layers, destroyed: false, destroy() { t.destroyed = true; } }; made.push(t); return t; };
  const g = { api: 'webgl2', caps: { floatTargets: true, maxLayers: 256 }, texture, copyLayers: (a: Tex, b: Tex, n: number) => { copies.push([a.label, b.layers, n]); return lands; } };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s: any = new Surface({ imagery: [], terrain: [] });
  s.g = g; s.tex = texture({ label: 'surface imagery', layers: 32 }); s.hTex = texture({ label: 'surface heights', layers: 32 });
  s.layersN = 32; s.layersCap = 192;
  s.tiles = new TileSet({ layers: 32, maxTiles: 100, isMiss: () => false, load: () => new Promise(() => {}) });
  const tex0 = s.tex;
  s.growImagery(40);
  assert.equal(s.layersN, 32, 'not grown: the copy did not land');
  assert.equal(s.tex, tex0, 'the old pool still drawn');
  assert.ok(!tex0.destroyed && made.slice(2).every((t) => t.destroyed), 'the new textures let go, the old kept');
  assert.equal(s.tiles.layers, 32, 'the tiles still hold 32 layers');
  assert.equal(s.layersCap, 192, 'one failure does not hold the pool');
  lands = true; s.growImagery(40);
  assert.equal(s.layersN, 48, 'grown at the next need');
  assert.ok(tex0.destroyed && !s.tex.destroyed && s.tex.layers === 48, 'the old pool let go once copied');
  assert.equal(s.tiles.layers, 48);
  assert.deepEqual(copies.at(-1), ['surface heights', 48, 32], 'imagery and heights copied');
  lands = false; for (let i = 0; i < Surface.growTries; i++) s.growImagery(60);
  assert.equal(s.layersN, 48); assert.equal(s.layersCap, 48, 'copies that never land hold the pool where it is (its tiles coarser)');
  s.tiles.dispose();
});

test('tiles: the ground asked in runs is the finest tile holding heights there, as a full search finds it (the last tile answers alone when none finer holds any), through loads and evictions', async () => {
  const N = 33, hOf = (z: number, x: number, y: number) => { const h = new Float32Array(N * N); for (let i = 0; i < h.length; i++) h[i] = z * 100 + (x % 7) * 10 + (y % 5) + i / h.length; return h; };
  const tiles = new TileSet({ layers: 12, maxTiles: 12, inflight: 64, isMiss: () => false, load: (e) => Promise.resolve({ heights: hOf(e.z, e.x, e.y) }) });
  // the full search: the finest tile in the cache holding heights at the place (the base levels, 0 … 2, only while
  // nothing finer than STAND_UP over them is known anywhere)
  const full = (lon: number, lat: number) => {
    const m = Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)), u = (lon + 180) / 360, v = (Math.PI - m) / (2 * Math.PI);
    let hz = 0; for (const e of tiles.cache.values()) if (e.h && e.z > hz) hz = e.z;
    for (let z = 20; z >= (hz > 2 + STAND_UP ? 3 : 0); z--) { const k = 2 ** z, x = Math.floor(u * k), y = Math.floor(v * k); for (const e of tiles.cache.values()) if (e.z === z && e.x === x && e.y === y && e.h) return z * 100 + (x % 7) * 10 + (y % 5); }
    return NaN;
  };
  const at = (z: number, x: number, y: number, c = 0) => ({ z, x, y, c, d: c });
  // a region at 12 with a corner of it at 14, then a view that moves on (evicting), then back
  const views = [[...[0, 1, 2, 3].map((i) => at(12, 3696 + i, 2516)), ...[0, 1].map((i) => at(14, 14784 + i, 10064))], [...[0, 1, 2, 3].map((i) => at(13, 7400 + i, 5040, i))], [at(12, 3696, 2516), at(12, 3697, 2516), at(15, 29568, 20128)]];
  let t = 0, checked = 0;
  for (const want of views) {
    for (let k = 0; k < 6; k++) { tiles.update(want, 'one', (t += 400), { lon: 145, lat: -37.9 }, [], 64); await new Promise<void>((ok) => setImmediate(ok)); }
    // a run over an area (as a chunk's ground grid asks), and back across it
    for (let j = 0; j < 60; j++) for (let i = 0; i < 60; i++) {
      const lon = 144.88 + i * 0.0045, lat = -37.86 - j * 0.0035, got = tiles.heightAt(lon, lat), want2 = full(lon, lat);
      if (Number.isNaN(want2)) { assert.ok(Number.isNaN(got) || got >= 0); continue; }
      assert.equal(Math.floor(got), want2, `the same tile answers at ${lon.toFixed(4)}, ${lat.toFixed(4)}`); checked++;
    }
  }
  assert.ok(checked > 2000, `asked (${checked})`);
  tiles.dispose();
});

test('tiles: a look change in a full pool settles: a wanted tile waiting to be shown is never given away to another wanted tile', async () => {
  // 22 tiles in 32 layers, their loads answering after 1 to 6 frames, the look changed after the first view: each tile
  // holds its old look while the new one loads, and the pool is full. It loaded thousands of times and never settled
  // (the pool losing layers: see the next test); a wanted tile's look waiting for the rest is kept, not loaded again
  for (const seed of [2, 5]) {
    let r = seed; const rnd = () => ((r = (r * 1103515245 + 12345) % 2147483648) / 2147483648);
    const waiting: { at: number; ok: (l: Loaded | null) => void }[] = []; let frame = 0, loads = 0;
    const tiles = new TileSet({ layers: 32, maxTiles: 400, inflight: 12, isMiss: () => false, load: () => { loads++; return new Promise((ok) => waiting.push({ at: frame + 1 + Math.floor(rnd() * 6), ok })); } });
    const want = Array.from({ length: 22 }, (_, i) => ({ z: 8, x: 200 + (i % 5), y: 120 + Math.floor(i / 5), c: i / 22, d: i }));
    let ver = 'a', done = -1;
    for (frame = 0; frame < 1500 && done < 0; frame++) {
      if (frame === 60) ver = 'b';
      for (const w of waiting.filter((x) => x.at <= frame)) { waiting.splice(waiting.indexOf(w), 1); w.ok({ heights: null }); }
      await new Promise<void>((ok) => setImmediate(ok));
      tiles.update(want, ver, frame * 33, { lon: 0, lat: 0 }, [], frame < 5 ? 16 : 12);
      if (ver === 'b' && tiles.settle(want, ver).done) done = frame;
    }
    assert.ok(done > 0, `seed ${seed}: the new look settles (${tiles.settle(want, ver).pending} tiles pending after ${loads} loads)`);
    assert.ok(loads < 120, `seed ${seed}: each tile loaded about twice, not over and over (${loads} loads)`);
    tiles.dispose(); for (const w of waiting) w.ok(null);
  }
});

test('tiles: no layer is ever lost: the tile asking for a layer never gives its own away to itself', async () => {
  // a full pool, looks changing, loads answering after up to 15 frames, the window of a moving view: the fallback a
  // level or two up (asked again for each new look) was the least recently used holder when it asked for a layer, so
  // it gave its own away and went on loading outside the set: its answer landed in a layer no tile owned. Every such
  // ask lost one, until the pool had none left and the view stayed loading (WebGPU under load: 17 of 48 lost)
  let r = 1; const rnd = () => ((r = (r * 1103515245 + 12345) % 2147483648) / 2147483648);
  const waiting: { at: number; ok: (l: Loaded | null) => void }[] = []; let frame = 0;
  const tiles = new TileSet({ layers: 32, maxTiles: 400, inflight: 12, isMiss: () => false, load: () => new Promise((ok) => waiting.push({ at: frame + 1 + Math.floor(rnd() * 15), ok })) });
  const want = Array.from({ length: 19 }, (_, i) => ({ z: 8, x: 200 + (i % 5), y: 120 + Math.floor(i / 5), c: i / 19, d: i }));
  for (frame = 0; frame < 1000; frame++) {
    for (const w of waiting.filter((x) => x.at <= frame)) { waiting.splice(waiting.indexOf(w), 1); w.ok({ heights: null }); }
    await new Promise<void>((ok) => setImmediate(ok));
    tiles.update(want, frame < 900 ? `v${Math.floor(frame / 20)}` : 'last', frame * 33, { lon: 0, lat: 0 }, [], 12);
  }
  for (let k = 0; k < 20 && waiting.length; k++) { for (const w of waiting.splice(0)) w.ok({ heights: null }); await new Promise<void>((ok) => setImmediate(ok)); }
  // (every load answered: the layers are the free ones and those the tiles hold)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const t = tiles as any; let held = 0;
  for (const e of t.cache.values()) held += (e.slot >= 0 ? 1 : 0) + (e.prev >= 0 ? 1 : 0) + (e.pend ? 1 : 0);
  assert.equal(held + t.free.length, 32, `every layer free or held by a tile (${held} held, ${t.free.length} free)`);
  assert.ok(tiles.settle(want, 'last').done, 'the last look settled');
  tiles.dispose();
});
