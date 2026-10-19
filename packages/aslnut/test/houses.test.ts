// modules › world › earth › presets › built › buildings (houses) and core › geometry › shapes › roofs: a house faces its
// street on its footprint's own axes (J), stays inside its footprint, eaves and verandas included (K), and so stands
// back from its property line as the measured footprint does (L); roofs of every form face out, their ridge along the
// long side (no pyramid on a deep house). Checked on made-up footprints, then on every baked house of the street
// place (the street tiles: data, not in git; those tests skip without them), as both the library's default house and
// the healthy-city example's house build them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { roofFaces, roofRise, type RoofForm } from '../src/core/geometry/shapes/roofs.ts';
import { MeshBuilder } from '../src/core/geometry/shapes/mesh.ts';
import { shape } from '../src/core/geometry/shapes/shape.ts';
import { housePlan, rectInside, rectArea } from '../src/modules/world/earth/presets/built/buildings/plan.ts';
import { house as defaultHouse, HOUSE } from '../src/modules/world/earth/presets/built/buildings/index.ts';
import { decodeBuiltTile } from '../src/modules/world/earth/presets/built/buildings/tiles.ts';
import { Rng, inside, nearestOn, orientedBox, type P2 } from '../src/modules/world/earth/shared/plan.ts';
import { house as cityHouse, ERAS } from '../examples/healthy-city/houses.ts';

const D2R = Math.PI / 180;
const rot = (pts: P2[], deg: number): P2[] => { const c = Math.cos(deg * D2R), s = Math.sin(deg * D2R); return pts.map(([x, z]) => [x * c - z * s, x * s + z * c]); };
/** an angle's distance from another's, both as axes (mod 90°) */
const axisOff = (a: number, b: number) => { const d = (((a - b) % 90) + 90) % 90; return Math.min(d, 90 - d); };
const axisOf = (ux: number, uz: number) => Math.atan2(uz, ux) / D2R;
/** the plan's points of a built mesh (x, z of every vertex) */
const plan = (m: Float32Array, dx = 0, dz = 0): P2[] => { const out: P2[] = []; for (let i = 0; i + 7 < m.length; i += 8) out.push([m[i]! + dx, m[i + 2]! + dz]); return out; };
function hull(pts: P2[]): P2[] {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]); if (p.length < 3) return p;
  const cr = (o: P2, a: P2, b: P2) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]), lo: P2[] = [], hi: P2[] = [];
  for (const x of p) { while (lo.length >= 2 && cr(lo[lo.length - 2]!, lo[lo.length - 1]!, x) <= 0) lo.pop(); lo.push(x); }
  for (let i = p.length - 1; i >= 0; i--) { const x = p[i]!; while (hi.length >= 2 && cr(hi[hi.length - 2]!, hi[hi.length - 1]!, x) <= 0) hi.pop(); hi.push(x); }
  return lo.slice(0, -1).concat(hi.slice(0, -1));
}
/** how far a point is outside a ring (0 inside) */
function outside(x: number, z: number, ring: readonly P2[]): number {
  if (inside(x, z, ring)) return 0;
  let best = Infinity; for (let i = 0; i < ring.length; i++) { const a = ring[i]!, b = ring[(i + 1) % ring.length]!, dx = b[0] - a[0], dz = b[1] - a[1], t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz || 1))); best = Math.min(best, Math.hypot(x - a[0] - dx * t, z - a[1] - dz * t)); }
  return best;
}
/** a house built both ways on a footprint (metres round its middle) facing `front` */
function built(who: 'default' | 'city', fp: P2[], front: P2 | null, seed = 3, era = 'auto', height = 4.5): Float32Array {
  const mb = new MeshBuilder();
  if (who === 'default') defaultHouse(mb, { ring: fp, height, front: front ? { x: front[0], z: front[1] } : undefined }, HOUSE, new Rng(seed), false, -0.3);
  else cityHouse.into(mb, { footprint: fp, height, front, seed, props: {}, era } as never, { seed });
  return mb.build();
}

test('roofs: every form faces out and covers its rectangle; a hip, dutch or gable ridge runs along the long side', () => {
  for (const form of ['flat', 'gable', 'hip', 'dutch', 'skillion', 'pyramidal'] as RoofForm[]) for (const [w, d] of [[12, 8], [8, 12]]) {
    const r = roofFaces(form, w!, d!, { pitch: 25, endInset: 0.4 });
    // the slopes' plan covers the rectangle once (their up-facing area), every slope faces up or out, never in
    let up = 0;
    for (let i = 0; i < r.slopes.length; i += 3) {
      const a = r.slopes[i]!, b = r.slopes[i + 1]!, c = r.slopes[i + 2]!;
      const n = [(b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]), (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]), (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])];
      const mid = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3];
      assert.ok(n[0]! * mid[0]! + n[1]! * (mid[1]! - r.rise * 0.3) + n[2]! * mid[2]! >= -1e-9, `${form} ${w}×${d}: a face turned in`);
      if (n[1]! > 0) up += n[1]! / 2;
    }
    assert.ok(Math.abs(up - w! * d!) < 1e-6, `${form} ${w}×${d}: covers ${up.toFixed(3)} m² of ${w! * d!}`);
    assert.ok(r.under.length === 6, `${form}: a soffit`);
    if (form === 'hip' || form === 'gable' || form === 'dutch') {
      // the ridge (the top's points) along the long side
      const top = r.slopes.filter((p) => Math.abs(p[1] - r.rise) < 1e-9), xs = top.map((p) => p[0]), zs = top.map((p) => p[2]);
      const along = w! >= d! ? Math.max(...xs) - Math.min(...xs) : Math.max(...zs) - Math.min(...zs), across = w! >= d! ? Math.max(...zs) - Math.min(...zs) : Math.max(...xs) - Math.min(...xs);
      assert.ok(along > 1 && across < 1e-9, `${form} ${w}×${d}: its ridge ${along.toFixed(2)} m along, ${across} across`);
      assert.equal(r.ridge, w! >= d! ? 'x' : 'z');
    }
  }
  // a dutch roof's gablets are walls; a gable's ends stand in at the rake; a skillion rises on its high side
  assert.equal(roofFaces('dutch', 12, 8).ends.length, 6);
  assert.ok(roofFaces('gable', 12, 8, { endInset: 0.4 }).ends.every((p) => Math.abs(Math.abs(p[0]) - 5.6) < 1e-9));
  assert.ok(roofFaces('skillion', 10, 6, { rise: 0.8, high: '-z' }).slopes.every((p) => (p[2] < 0 ? Math.abs(p[1] - 0.8) < 1e-9 : p[1] === 0)));
  assert.ok(Math.abs(roofRise('hip', 8, 12, { pitch: 30 }).rise - 4 * Math.tan(30 * D2R)) < 1e-9);
});

test('scopes: a flat panel is drawn only at the levels its detail asks (a window frame of detail 0: the whole only)', () => {
  const s = shape({ simple: true, build: (b) => { const f = b.scope({ size: [4, 3, 4] }).faces().front; f.panel({ flat: true, detail: 0 }); f.inset(1, 1).panel({ flat: true, detail: 1 }); } });
  const m = s.make();
  assert.equal(m.triangles[0], 4); assert.equal(m.triangles[1], 2);
  const mb0 = new MeshBuilder(), mb1 = new MeshBuilder();
  s.into(mb0, {}, { level: 0 }); s.into(mb1, {}, { level: 1 });
  assert.equal(mb0.count / 3, 4); assert.equal(mb1.count / 3, 2);
});

test('plan: a footprint faces its street on its own axes; its rectangles lie inside it (an L: a main body and a wing in front)', () => {
  for (const turn of [0, 20, -35, 60, 133]) {
    const L = rot([[-6, -7], [6, -7], [6, 7], [0, 7], [0, 11], [-6, 11]], turn), front = rot([[0, 1]], turn)[0]!;
    const p = housePlan(L, front);
    // its z (towards the street) is the front; its x along the street; the frame b.frame({ turn }) makes
    assert.ok(p.z[0] * front[0] + p.z[1] * front[1] > 0.9999, `turn ${turn}: faces its front`);
    const c = Math.cos(p.turn * D2R), s = Math.sin(p.turn * D2R);
    assert.ok(Math.abs(-s - p.z[0]) < 1e-9 && Math.abs(c - p.z[1]) < 1e-9 && Math.abs(c - p.x[0]) < 1e-9 && Math.abs(s - p.x[1]) < 1e-9, `turn ${turn}: the frame's turn carries z onto the front`);
    assert.ok(Math.abs(rectArea(p.main) - 12 * 14) < 1.5, `turn ${turn}: the main body ${rectArea(p.main).toFixed(1)} m²`);
    assert.equal(p.wings.length, 1); assert.equal(p.wings[0]!.side, 'front');
    assert.ok(p.cover > 0.98, `turn ${turn}: covers ${p.cover.toFixed(3)}`);
    for (const r of [p.main, ...p.wings]) assert.ok(rectInside(p, r), `turn ${turn}: a rectangle outside the footprint`);
  }
  // a rectangle with no front faces south-most; a back addition is a wing at the back
  const add = housePlan([[-6, -4], [-5, -4], [-5, -9], [3, -9], [3, -4], [6, -4], [6, 8], [-6, 8]], [0, 1]);
  assert.equal(add.wings[0]?.side, 'back');
  assert.ok(housePlan([[-5, -3], [5, -3], [5, 3], [-5, 3]], null).z[1] > 0.99);
});

test('houses on made-up footprints: square to them, facing the front, everything inside the footprint (both looks, every era)', () => {
  const shapes: Record<string, P2[]> = { deep: [[-6, -8], [6, -8], [6, 8], [-6, 8]], wide: [[-8, -5], [8, -5], [8, 5], [-8, 5]], L: [[-6, -7], [6, -7], [6, 7], [0, 7], [0, 11], [-6, 11]], Z: [[-6.9, 8.6], [1.3, 8.6], [1.3, 2.5], [4.2, 2.6], [4.2, -8], [1.3, -8.1], [1.3, -3.1], [-6.9, -3]] };
  for (const [name, fp0] of Object.entries(shapes)) for (const turn of [0, 17, -35, 62]) {
    const fp = rot(fp0, turn), front = rot([[0, 1]], turn)[0]!, box = orientedBox(fp);
    for (const [who, era] of [['default', 'auto'] as const, ...ERAS.map((e) => ['city', e] as const)]) {
      const pts = plan(built(who, fp, front, 5, era)), hb = orientedBox(hull(pts));
      const off = axisOff(axisOf(hb.ux, hb.uz), axisOf(box.ux, box.uz)), far = Math.max(...pts.map(([x, z]) => outside(x, z, fp)));
      assert.ok(off < 0.5, `${who} ${era} ${name} turned ${turn}: ${off.toFixed(2)}° off its footprint`);
      assert.ok(far < 0.02, `${who} ${era} ${name} turned ${turn}: ${far.toFixed(3)} m outside its footprint`);
    }
  }
  // the healthy-city house's triangles stay in its budget at every era (its simple level less)
  const check = cityHouse.check({ footprint: shapes.L!, height: 4.5, front: [0, 1], seed: 3, props: {} } as never);
  assert.ok(check.ok, check.problems.join(' · '));
});

// ── every baked house of the street place ───────────────────────────────────────────────────────────────────────
const TILES = join(import.meta.dirname, '..', '..', '..', 'data', 'packs', 'roads', 'street', 'built');
const hasTiles = existsSync(join(TILES, 'index.json'));
const needsTiles = { skip: hasTiles ? false : 'the street tiles are not in data/packs/roads/street/built (the street place\'s bake)' };
interface H { X: number; Z: number; ring: P2[]; local: P2[]; front: P2 | null; line: { px: number; pz: number; tx: number; tz: number } | null; seed: number; height: number }
/** the houses of every `every`-th tile, and their streets (classes 2…5, as the street level takes them) */
function load(every: number): { houses: H[]; segs: { ax: number; az: number; bx: number; bz: number }[] } {
  const idx = JSON.parse(readFileSync(join(TILES, 'index.json'), 'utf8')), houses: H[] = [], segs: { ax: number; az: number; bx: number; bz: number }[] = [];
  const poly = (f: number[], s: number, per = 10) => { const out: P2[] = []; let x = f[s]!, z = f[s + 1]!; out.push([x / per, z / per]); for (let i = s + 2; i + 1 < f.length; i += 2) { x += f[i]!; z += f[i + 1]!; out.push([x / per, z / per]); } return out; };
  (idx.tiles as [number, number][]).forEach(([ix, iz], ti) => {
    if (ti % every) return;
    const t = decodeBuiltTile(JSON.parse(readFileSync(join(TILES, `${ix}_${iz}.json`), 'utf8'))) as Record<string, any>, ox = ix * 500, oz = iz * 500;
    for (const r of t.roads as number[][]) { if (r[0]! < 2 || r[0]! > 5) continue; const p = poly(r, 4); for (let k = 0; k + 1 < p.length; k++) segs.push({ ax: p[k]![0] + ox, az: p[k]![1] + oz, bx: p[k + 1]![0] + ox, bz: p[k + 1]![1] + oz }); }
    const fronts = new Map<number, number[]>((t.fronts as number[][]).map((f) => [f[0]!, f]));
    (t.buildings as number[][]).forEach((b, k) => {
      if (t.homes?.[k] !== 1) return;
      let ring = poly(b, 3); if (ring.length > 1 && ring[0]![0] === ring.at(-1)![0] && ring[0]![1] === ring.at(-1)![1]) ring = ring.slice(0, -1); if (ring.length < 3) return;
      let cx = 0, cz = 0; for (const [x, z] of ring) { cx += x; cz += z; } cx /= ring.length; cz /= ring.length;
      const fr = fronts.get(k); let front: P2 | null = null, line = null;
      if (fr) { const px = fr[1]! / 10, pz = fr[2]! / 10, tx = fr[3]! / 1000, tz = fr[4]! / 1000, s = (px - cx) * -tz + (pz - cz) * tx > 0 ? 1 : -1; front = [-tz * s, tx * s]; line = { px: px + ox, pz: pz + oz, tx, tz }; }
      houses.push({ X: cx + ox, Z: cz + oz, ring: ring.map(([x, z]) => [x + ox, z + oz]), local: ring.map(([x, z]) => [x - cx, z - cz]), front, line, seed: t.seeds?.[k] ?? 0, height: b[0]! / 10 });
    });
  });
  return { houses, segs };
}
const quant = (v: number[], q: number) => { const s = [...v].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(s.length * q))] ?? NaN; };
for (const who of ['default', 'city'] as const) {
  test(`every baked house (${who === 'default' ? "the library's default" : "healthy-city's"}): J square to its footprint and so to its street, K inside its footprint, L set back as measured`, needsTiles, () => {
    const { houses, segs } = load(6);
    assert.ok(houses.length > 2000, `${houses.length} houses`);
    const drawnVsFoot: number[] = [], drawnVsStreet: number[] = [], footVsStreet: number[] = [], setD: number[] = [], setM: number[] = [];
    let outsideHouses = 0, furthest = 0;
    const sb = (h: H, pts: P2[]) => { const l = h.line!, nx0 = -l.tz, nz0 = l.tx, s = (h.X - l.px) * nx0 + (h.Z - l.pz) * nz0 > 0 ? 1 : -1; let m = Infinity; for (const [x, z] of pts) m = Math.min(m, ((x - l.px) * nx0 + (z - l.pz) * nz0) * s); return m; };
    for (const h of houses) {
      const near = nearestOn(h.X, h.Z, segs), front = h.front ?? (near && near.d < 70 ? [(near.px - h.X) / near.d, (near.pz - h.Z) / near.d] as P2 : null);
      const pts = plan(built(who, h.local, front, h.seed, 'auto', h.height), h.X, h.Z);
      // J: the drawn house's axis (its plan's least box) against its footprint's and its street's
      const hb = orientedBox(hull(pts)), fb = orientedBox(h.ring), a = axisOf(hb.ux, hb.uz), fa = axisOf(fb.ux, fb.uz);
      drawnVsFoot.push(axisOff(a, fa));
      if (near && near.d < 70) { const sa = axisOf(near.tx, near.tz); drawnVsStreet.push(axisOff(a, sa)); footVsStreet.push(axisOff(fa, sa)); }
      // K: every point of it inside its footprint (within 10 cm: the footprints are stored to the decimetre)
      let far = 0; for (const [x, z] of pts) far = Math.max(far, outside(x, z, h.ring));
      if (far > 0.1) outsideHouses++; furthest = Math.max(furthest, far);
      // L: its setback from the property line (the bake's front) against its footprint's
      if (h.line) { setD.push(sb(h, pts)); setM.push(sb(h, h.ring)); }
    }
    // J: as square to the street as the measured footprints are (before: every healthy-city house off by twice its street's angle)
    assert.ok(quant(drawnVsFoot, 0.99) < 1, `drawn vs footprint p99 ${quant(drawnVsFoot, 0.99).toFixed(2)}°`);
    assert.ok(quant(drawnVsStreet, 0.5) <= quant(footVsStreet, 0.5) + 0.5, `drawn vs street median ${quant(drawnVsStreet, 0.5).toFixed(2)}° (footprints ${quant(footVsStreet, 0.5).toFixed(2)}°)`);
    assert.ok(drawnVsStreet.filter((x) => x > 10).length <= footVsStreet.filter((x) => x > 10).length * 1.05 + 5, 'no more houses over 10° off their street than footprints');
    // K: nothing outside its footprint, so no two next-door houses overlap (the footprints do not)
    assert.equal(outsideHouses, 0, `${outsideHouses} houses reach outside their footprint (furthest ${furthest.toFixed(2)} m)`);
    // L: its front where its footprint's is (the eaves, a veranda at the footprint's edge): the spread of next-door
    // setbacks is the measured one
    const diff = setD.map((d, i) => d - setM[i]!);
    assert.ok(quant(diff, 0.5) < 0.1 && quant(diff, 0.9) < 0.8, `drawn − measured setback median ${quant(diff, 0.5).toFixed(2)} m, p90 ${quant(diff, 0.9).toFixed(2)} m`);
    assert.ok(diff.filter((x) => x < -0.05).length === 0, 'nothing drawn in front of its footprint');
  });
}
