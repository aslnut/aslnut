import { VIC_STREETS, profileFor } from './presets/built/roads/street-profiles.ts';
// modules › world › earth › street: a city's street level from open data, streamed in 500 m tiles (the tile format of
// tools/demo-data-city-tiles.mjs: roads by class, building footprints with heights, real trees, open space, water).
// Each tile becomes solids: the carriageways and their kerbs, nature strips and footpaths; parks and sports grounds,
// lakes and streams on the ground; detached houses with their roofs, fences and bins, other buildings raised to their
// heights with windows; every tree with its height and crown; power poles along the streets and their wires. Every
// thing is pickable and says what it is and where its data comes from.
//   const st = streets({ url: '/packs/city/tiles/index.json' }); w.add(st, st.wires)
import { earcut } from '../../../core/geometry/build/earcut.ts';
import { MeshBuilder } from '../../../core/geometry/shapes/mesh.ts';
import type { SolidInfo, SolidsChunk } from '../../../core/geometry/shapes/solids.ts';
import type { WorkerLane } from '../../../core/runtime/workers.ts';
import { Rows } from '../../../core/data/sources/index.ts';
import { StreetDetail, type DetailContext, type StreetDetailProps } from '../surface/street-detail.ts';
import { BLOCK, HOUSE, LOT, bins, driveway, fence, footprint, house, isHouse, type BlockLook, type HouseLook, type LotLook } from './presets/built/buildings/index.ts';
import { decodeBuiltTile } from './presets/built/buildings/tiles.ts';
import { stream as streamRibbon, waterArea, WATER, type WaterLook } from './water/hydrology/index.ts';
import { POLES, poles, wires, type PoleLook, type Span, type WireDatum } from './presets/built/infrastructure/index.ts';
import { ROAD_CLASS, STREET, STREETS_LOOK, junctionMesh, sectionMesh, type StreetLook } from './presets/built/roads/index.ts';
import { cut, lengthOf, reserveAcross, vergeWidth, type ProfileRules, type Section } from '../../../core/geometry/networks/sections.ts';
import { solveJunctions } from '../../../core/geometry/networks/junctions.ts';
import { walkways, type Walkway } from '../../../core/geometry/networks/walkways.ts';
import { Footprints, Rng, inside, nearestOn, seedOf, signedArea, type P2 } from './shared/plan.ts';
import { TREES, treeInstances, treeShapes, type TreeLook } from './presets/living/plants/index.ts';
import type { Leveled } from '../../../core/observation/presence.ts';

/** one tile as stored (v1): decimetres from its north-west corner, x east, z south, polylines delta encoded */
export interface CityTile {
  v: number; ix: number; iz: number; size: number; s: string[];
  roads: number[][]; buildings: number[][]; trees: number[]; parks: number[][]; water: number[][]; streams: number[][];
  /** the road reserve (the land between the property boundaries): [junction 0 | 1, x0, z0, …] */
  reserves?: number[][];
  /** (v2) every junction this tile's roads touch, with all its arms: [arms, then per arm: class, road id, end, points,
   *  x0, z0, …] (each tile solves them the same way as its neighbours: the platform drawn by the tile it lies in) */
  junctions?: number[][];
  /** (baked) the roads, footpaths and nature strips are another layer's (tools › compile: the baked roads): this tile
   *  draws none; its trees and houses were resolved against them */
  baked?: boolean;
  /** (baked) each house's front line: [building index, x, z (dm from the corner), along x, along z (× 1000)] */
  fronts?: number[][];
  /** (baked) the corner each building stands on (its index in its outline): the same whatever ground is loaded */
  anchors?: number[];
  /** (baked, v3) each building's pad: [floor, foundation's foot] in cm over its anchor's ground (the bake's graded
   *  ground), flat */
  pads?: number[];
  /** (baked, v3) each building's and each tree's seed (the source's: a look chosen from it stays when others go) */
  seeds?: number[]; tseeds?: number[];
  /** (baked, v3) per building, 1 when the bake made it a house, else 0 (a tile without them: `isHouse` decides) */
  homes?: number[];
  /** (baked, v3) each house's plot: [building index, x0, z0, dx, dz …] (half metres) */
  lots?: number[][];
  /** (baked, v3) furniture: [kind, x, z, id, seed] flat (strings by index) */
  furniture?: number[];
  /** (baked, v3) the bake's patches on pieces: [what (0 building, 1 tree, 2 furniture), index, text, source tile x, z, row] */
  patches?: number[][];
  /** (baked, v3) what the bake left out: [what (0 building, 1 plot, 2 tree, 3 furniture), x, z (dm), check, id] */
  omitted?: number[][];
}
export interface CityLook {
  street: StreetLook; house: HouseLook; block: BlockLook; lot: LotLook; trees: TreeLook; poles: PoleLook; water: WaterLook; park: string; sports: string;
  /** a baked building's foundation (its pad's skirt down to the ground) */
  foundation?: string;
  /** a baked house's pad: its top round the walls (they stand in under the eaves) */
  pad?: string;
  /** houses of your own (core › geometry › shapes): built on each house's footprint (metres round its middle, x east,
   *  z south), its height, the way to its street (a unit vector, or null), a seed; in place of the plain ones */
  houses?: { into(mb: MeshBuilder, site: HouseSite, o: { at?: [number, number, number]; id?: number; anchor?: [number, number]; seed?: number; level?: number }): unknown };
  /** how a road's profile is made where the data says less (core › geometry › networks › sections) */
  rules?: ProfileRules;
}
/** what a house of your own is built on */
export interface HouseSite { footprint: [number, number][]; height: number; front: [number, number] | null; seed: number; props: Record<string, unknown>;
  /** (baked) its plot round the same middle: a look that needs more room fits itself inside it */
  lot?: [number, number][] }
export const CITY: CityLook = { street: STREET, house: HOUSE, block: BLOCK, lot: LOT, trees: TREES, poles: POLES, water: WATER, park: '#6f9a4c', sports: '#5f9a45' };
/** what a built tile gives besides its solids: its roads (for networks), its houses (for access), its wire spans */
export interface CityExtra {
  roads: { cls: number; width: number; name: string; pts: P2[] }[];
  /** (baked) the furniture placed by the bake (tile metres), the plots, and what the bake left out: drawn by the app
   *  with a look of its own (shape() → entities()) */
  furniture?: { kind: string; x: number; z: number; id: string; seed: number; patched?: string }[];
  lots?: { building: number; ring: P2[] }[];
  omitted?: { what: 'building' | 'plot' | 'tree' | 'furniture'; x: number; z: number; check: string; id: string }[];
  /** the footpaths' middle lines (a walking graph: core › geometry › networks › walkways) */
  walkways?: Walkway[];
  /** each house's middle, its id, and its top: metres over the ground where it stands (its pad and height) */
  houses: { x: number; z: number; id: number; top: number }[];
  parks: { name: string; group: string; ring: P2[]; id: number }[];
  spans: Span[];
}
const polyline = (f: readonly number[], start: number): P2[] => {
  const out: P2[] = []; let x = f[start]!, z = f[start + 1]!; out.push([x / 10, z / 10]);
  for (let i = start + 2; i + 1 < f.length; i += 2) { x += f[i]!; z += f[i + 1]!; out.push([x / 10, z / 10]); }
  return out;
};
const HEIGHT_SOURCE = ['measured', 'from floors', 'default'];

/** a tile → its solids, with what each id is */
export function cityTile(t: CityTile, ctx: DetailContext, look: CityLook = CITY, sources: Record<string, { title: string; licence: string }> = {}, show: (kind: string) => boolean = () => true): { chunk: { mesh: Float32Array; far: Float32Array; instances: NonNullable<SolidsChunk['instances']>; info: (id: number) => SolidInfo | null }; extra: CityExtra; infos: SolidInfo[]; trees: { key: string; data: Float32Array }[] } {
  // the mesh, and a lighter one for far away and the sun's shadow map (the same ids)
  decodeBuiltTile(t as unknown as Record<string, unknown>);
  const mb = new MeshBuilder(), fb = new MeshBuilder(), infos: SolidInfo[] = [], str = (i: number) => t.s?.[i] ?? '';
  // the bake's patches by piece (what, index → texts)
  const patched = new Map<string, string[]>(); for (const [w, i, k, sx, sz, sk] of t.patches ?? []) { const key = `${w}:${i}`; const l = patched.get(key) ?? []; l.push(`${str(k!)}${sk !== undefined && sk >= 0 ? ` · source row bld-${sx}-${sz}-${sk}` : ''}`); patched.set(key, l); }
  const placement = (w: number, i: number) => { const l = patched.get(`${w}:${i}`); return l ? { placement: l.join(' · ') } : {}; };
  const src = (k: string) => (sources[k] ? `${sources[k]!.title} (${sources[k]!.licence})` : k);
  const newId = (info: SolidInfo) => { infos.push(info); return infos.length - 1; };
  const ground = (x: number, z: number) => ctx.groundAt(x, z);
  const extra: CityExtra = { roads: [], houses: [], parks: [], spans: [] };
  const rngT = (k: number) => new Rng(t.seeds?.[k] ?? seedOf(t.ix, t.iz, k));
  // open space and water on the ground
  for (const p of show('park') ? t.parks : []) {
    const ring = polyline(p, 3), name = str(p[0]!), group = str(p[1]!); if (ring.length < 3) continue;
    const id = newId({ kind: 'park', id: `park-${t.ix}-${t.iz}-${infos.length}`, props: { name: name || 'open space', group, 'area (ha)': +(p[2]! / 1e4).toFixed(2), source: src('parks') } });
    const tri = earcut(ring.flat(), [], 2), col = /organised|sport/i.test(group) ? look.sports : look.park;
    mb.as(id).floor(ring, 0.08, col, tri); fb.as(id).floor(ring, 0.08, col, tri);
    extra.parks.push({ name, group, ring, id });
  }
  for (const w of show('water') ? t.water : []) {
    const ring = polyline(w, 3); if (ring.length < 3) continue;
    mb.as(newId({ kind: 'water', id: `water-${t.ix}-${t.iz}-${infos.length}`, props: { name: str(w[0]!) || 'water', type: str(w[1]!).replace(/_/g, ' '), 'area (ha)': +(w[2]! / 1e4).toFixed(2), source: src('water') } }));
    waterArea(mb, ring, look.water); fb.as(mb.idNow); waterArea(fb, ring, look.water);
  }
  for (const s of show('waterway') ? t.streams : []) {
    const pts = polyline(s, 3); if (pts.length < 2) continue;
    mb.as(newId({ kind: 'waterway', id: `stream-${t.ix}-${t.iz}-${infos.length}`, props: { name: str(s[1]!) || 'waterway', type: str(s[2]!).replace(/_/g, ' '), 'width (m)': s[0]! / 10, source: src('water') } }));
    streamRibbon(mb, pts, s[0]! / 10, look.water); fb.as(mb.idNow); streamRibbon(fb, pts, s[0]! / 10, look.water);
  }
  // roads: sections between junctions (their profile from the road reserve where the data has it, then the rules),
  // the junctions solved from their arms; each road's verge out to its property line; poles where the look asks
  const v2 = (t.v ?? 1) >= 2, rules = look.rules ?? VIC_STREETS;
  const roads = t.roads.map((r) => ({ cls: r[0]!, width: r[1]! / 10, name: str(r[2]!), uid: v2 ? str(r[3]!) : '', pts: polyline(r, v2 ? 4 : 3) })).filter((r) => r.pts.length > 1).sort((a, b) => b.cls - a.cls);
  const reserves = (t.reserves ?? []).filter((r) => r[0] === 0).map((r) => polyline(r, 1));
  const profileOf = (cls: number, pts: P2[]) => profileFor(cls, { reserve: reserves.length ? reserveAcross(pts, reserves) : undefined }, rules);
  const sections: Section[] = roads.map((r, i) => ({ id: r.uid || `road-${t.ix}-${t.iz}-${i}`, cls: r.cls, name: r.name, pts: r.pts, trim: [0, 0], ends: [null, null], profile: profileOf(r.cls, r.pts) }));
  // the junctions: from every arm (a neighbour's road an arm too, its first 30 m), each arm's width from its first
  // metres (the same in every tile that solves it); this tile's roads take the cut-backs, the tile a junction lies in
  // draws its platform
  let junctions = [] as ReturnType<typeof solveJunctions>;
  const drawRoads = show('road') && !t.baked;
  if (drawRoads) {
    if (v2 && t.junctions) {
      const mine = new Map(sections.map((s) => [s.id, s]));
      for (const jr of t.junctions) {
        let q = 1; const arms: Section[] = [];
        for (let a = 0; a < jr[0]!; a++) {
          const cls = jr[q]!, uid = str(jr[q + 1]!), end = jr[q + 2]!, n = jr[q + 3]!, pts: P2[] = [];
          let x = jr[q + 4]!, z = jr[q + 5]!; pts.push([x / 10, z / 10]); for (let k = 1; k < n; k++) { x += jr[q + 4 + 2 * k]!; z += jr[q + 5 + 2 * k]!; pts.push([x / 10, z / 10]); }
          q += 4 + 2 * n;
          arms.push({ id: `${uid}@${end}`, cls, name: mine.get(uid)?.name ?? '', pts, trim: [0, 0], ends: [null, null], profile: profileOf(cls, pts) });
        }
        const [j] = solveJunctions(arms);
        if (!j) continue;
        // the cut-backs onto this tile's own roads (by id and end)
        for (const arm of j.arms) { const [uid, end] = arm.section.id.split('@') as [string, string]; const s = mine.get(uid); if (s) s.trim[Number(end) as 0 | 1] = Math.max(s.trim[Number(end) as 0 | 1], j.trim); }
        if (j.at[0] >= 0 && j.at[1] >= 0 && j.at[0] < t.size && j.at[1] < t.size) junctions.push(j);
      }
    } else junctions = solveJunctions(sections);
  }
  const keep = new Footprints();
  roads.forEach((r, i) => {
    extra.roads.push(r);
    if (!drawRoads) return;
    const sec = sections[i]!, p = sec.profile;
    const id = newId({ kind: 'road', id: sec.id, props: { name: r.name || 'unnamed road', class: ROAD_CLASS[r.cls] ?? `class ${r.cls}`, 'carriageway (m)': +p.carriageway.toFixed(1), 'footpath (m)': +Math.max(p.left.footpath, p.right.footpath).toFixed(1), 'reserve (m)': p.reserve.left !== null && p.reserve.right !== null ? +(p.reserve.left + p.reserve.right).toFixed(1) : '—', 'profile from': p.from === 'reserve' ? 'the road reserve (Vicmap Property)' : p.from === 'tags' ? 'tags' : 'the class', source: src('roads') } });
    mb.as(id).on(null); fb.as(id).on(null);
    sectionMesh(mb, sec, { ...STREETS_LOOK, ...look.street }); sectionMesh(fb, sec, { ...STREETS_LOOK, ...look.street }, true);
    // what trees and furniture may not stand on: the carriageway with its kerbs, the footpaths
    const L = lengthOf(sec.pts), line = cut(sec.pts, 0, L), h = p.carriageway / 2;
    keep.addBand(line, -(h + p.left.kerb), h + p.right.kerb);
    if (p.left.footpath > 0) { const a = h + p.left.kerb + p.left.strip; keep.addBand(line, -(a + p.left.footpath), -a); }
    if (p.right.footpath > 0) { const a = h + p.right.kerb + p.right.strip; keep.addBand(line, a, a + p.right.footpath); }
    const rnd = rngT(7000 + i);
    if (r.cls >= 4 && r.cls <= 5 && look.poles.chance > 0 && rnd.chance(look.poles.chance)) {
      const side = rnd.chance(0.5) ? 1 : -1, v = side > 0 ? p.right : p.left, off = (h + vergeWidth(v) - v.gap - v.footpath - 0.4) * side;
      const pid = newId({ kind: 'pole', id: `poles-${t.ix}-${t.iz}-${i}`, props: { what: 'power poles (procedural)', along: r.name || 'unnamed road', 'height (m)': look.poles.height } });
      mb.as(pid); poles(mb, r.pts, off, look.poles, extra.spans);
    }
  });
  junctions.forEach((j, k) => {
    const jid = newId({ kind: 'junction', id: `junction-${t.ix}-${t.iz}-${k}`, props: { arms: j.arms.length, roads: [...new Set(j.arms.map((a) => a.section.name).filter(Boolean))].join(' · ') || 'unnamed roads', source: src('roads') } });
    mb.as(jid).on(null); fb.as(jid).on(null);
    junctionMesh(mb, j, { ...STREETS_LOOK, ...look.street }); junctionMesh(fb, j, { ...STREETS_LOOK, ...look.street }, true);
    keep.addRing(j.platform);
    for (const c of j.corners) for (const b of c.bands) if (b.kind !== 'strip') keep.addRing([...b.inner, ...[...b.outer].reverse()]);
  });
  if (drawRoads) extra.walkways = walkways(sections, junctions);
  // buildings: houses facing their street with fence and bins; the others raised with windows
  const segs: { ax: number; az: number; bx: number; bz: number; width: number; cls: number; sec: Section }[] = [];
  roads.forEach((r, i) => { if (r.cls >= 2 && r.cls <= 5) for (let k = 0; k + 1 < r.pts.length; k++) segs.push({ ax: r.pts[k]![0], az: r.pts[k]![1], bx: r.pts[k + 1]![0], bz: r.pts[k + 1]![1], width: r.width, cls: r.cls, sec: sections[i]! }); });
  const footprints: P2[][] = [];
  const fronts = new Map<number, [number, number, number, number]>((t.fronts ?? []).map((f) => [f[0]!, [f[1]! / 10, f[2]! / 10, f[3]! / 1000, f[4]! / 1000]]));
  // (v3) the frontage's span along the line (a fence goes there, the plot's own), the plots
  const spans = new Map<number, [number, number]>((t.fronts ?? []).filter((f) => f.length >= 7).map((f) => [f[0]!, [f[5]! / 10, f[6]! / 10]]));
  const lots = new Map<number, P2[]>((t.lots ?? []).map((l) => [l[0]!, polyline(l, 1).map(([x, z]) => [x * 5, z * 5] as P2)]));
  if (lots.size) extra.lots = [...lots].map(([building, ring]) => ({ building, ring }));
  t.buildings.forEach((b, k) => {
    let ring = polyline(b, 3);
    if (ring.length > 1 && ring[0]![0] === ring[ring.length - 1]![0] && ring[0]![1] === ring[ring.length - 1]![1]) ring = ring.slice(0, -1);
    if (ring.length < 3) return;
    footprints.push(ring);
    const h = b[0]! / 10, cls = str(b[2]!), area = Math.abs(signedArea(ring)), rnd = rngT(k);
    let cx = 0, cz = 0; for (const [x, z] of ring) { cx += x; cz += z; } cx /= ring.length; cz /= ring.length;
    // it stands on the lowest ground under its corners (where the ground is known: else its middle)
    let anchor: P2 = [cx, cz], lo = Infinity;
    const ai = t.anchors?.[k];
    if (ai !== undefined && ring[ai]) anchor = ring[ai]!;
    else for (const p of ring) { const g = ground(p[0], p[1]); if (g < lo) { lo = g; anchor = p; } }
    // (baked) the bake decided which are houses (an outline too big for one is not: stage 12's house-size)
    const home = t.homes?.length ? t.homes[k] === 1 : isHouse(cls, area, h);
    if (!show('building')) { if (home) extra.houses.push({ x: cx, z: cz, id: -1, top: h }); return; }
    const id = newId({ kind: 'building', id: `bld-${t.ix}-${t.iz}-${k}`, props: { kind: cls || (home ? 'house' : 'building'), 'height (m)': h, 'height from': HEIGHT_SOURCE[b[1]!] ?? 'default', 'footprint (m²)': Math.round(area), ...placement(0, k), source: src('buildings') } });
    mb.as(id).on(anchor); fb.as(id).on(anchor);
    // a baked pad: the foundation from its foot up to the floor, the building on the floor
    const pad = t.pads ? t.pads[2 * k]! / 100 : 0;
    if (t.pads) {
      const foot = t.pads[2 * k + 1]! / 100, col = look.foundation ?? '#8d877c'; for (let e = 0; e < ring.length; e++) { const [ax, az] = ring[e]!, [bx, bz] = ring[(e + 1) % ring.length]!; mb.wall(ax, az, bx, bz, foot, pad, col); fb.wall(ax, az, bx, bz, foot, pad, col); }
      // a house's walls stand in under its eaves: the pad's top shows round them (a slab, not a hole down to the ground)
      if (home && foot < pad) { const tri = earcut(ring.flat(), [], 2), top = look.pad ?? '#8f8a80'; for (let q = 0; q + 2 < tri.length; q += 3) { const a = ring[tri[q]!]!, b2 = ring[tri[q + 1]!]!, c = ring[tri[q + 2]!]!, up = (b2[1] - a[1]) * (c[0] - a[0]) - (b2[0] - a[0]) * (c[1] - a[1]) > 0; mb.tri([a[0], pad, a[1]], up ? [b2[0], pad, b2[1]] : [c[0], pad, c[1]], up ? [c[0], pad, c[1]] : [b2[0], pad, b2[1]], top); } }
      mb.lift(pad); fb.lift(pad);
    }
    const done = () => { mb.lift(0); fb.lift(0); };
    // (on a pad with a foundation the walls start at its floor: the foundation's faces below are the only ones there)
    const base = t.pads && t.pads[2 * k + 1]! / 100 < pad ? 0 : undefined;
    if (!home) { footprint(mb, ring, h, rnd, look.block, false, base); footprint(fb, ring, h, rngT(k), look.block, true, base); done(); return; }
    extra.houses.push({ x: cx, z: cz, id, top: pad + h });
    // a big house (over 400 m²): raised under a flat roof (a hip over it would stand like a pyramid), unless the look
    // builds its own houses
    if (!look.houses && area > 400) { footprint(mb, ring, h, rnd, look.block, false, base); footprint(fb, ring, h, rngT(k), look.block, true, base); done(); return; }
    // it faces its street: (baked) square to its property line, the bake's front; else towards the nearest road
    const near = nearestOn(cx, cz, segs), fr0 = fronts.get(k);
    const front = fr0 ? (() => { const [px, pz, tx, tz] = fr0, s = (px - cx) * -tz + (pz - cz) * tx > 0 ? 1 : -1; return { x: -tz * s, z: tx * s }; })() : near && near.d < 70 ? { x: (near.px - cx) / near.d, z: (near.pz - cz) / near.d } : undefined;
    if (look.houses) {
      // your house: built on its footprint round its middle, standing on the ground at its anchor; the far mesh simple
      const lot = lots.get(k), site: HouseSite = { footprint: ring.map(([x, z]) => [x - cx, z - cz]), height: h, front: front ? [front.x, front.z] : null, seed: t.seeds?.[k] ?? seedOf(t.ix, t.iz, k), props: { kind: cls }, ...(lot ? { lot: lot.map(([x, z]) => [x - cx, z - cz] as [number, number]) } : {}) };
      mb.lift(0); fb.lift(0);
      look.houses.into(mb, site, { at: [cx, pad, cz], id, anchor, seed: site.seed });
      look.houses.into(fb, site, { at: [cx, pad, cz], id, anchor, seed: site.seed, level: 1 });
    } else { house(mb, { ring, height: h, front }, look.house, rnd, false, base); house(fb, { ring, height: h, front }, look.house, rngT(k), true, base); }
    done();
    // a baked tile: the front line is the property line before the house (the bake's)
    const fr = fronts.get(k);
    if (fr) {
      const [px, pz, tx, tz] = fr, nx0 = -tz, nz0 = tx, side = (cx - px) * nx0 + (cz - pz) * nz0 > 0 ? 1 : -1, nx = nx0 * side, nz = nz0 * side;
      let t0 = Infinity, t1 = -Infinity; for (const [x, z] of ring) { const s = (x - px) * tx + (z - pz) * tz; t0 = Math.min(t0, s); t1 = Math.max(t1, s); }
      t0 -= 1.5; t1 += 1.5;
      const sp = spans.get(k); if (sp) { if (sp[1] - sp[0] < 1) return; t0 = sp[0]; t1 = sp[1]; }
      const L = (s: number, o: number): P2 => [px + tx * s + nx * o, pz + tz * s + nz * o];
      const lot = look.lot, kind = rnd.chance(lot.fence.chance) ? rnd.weighted(lot.fence.types) : 'none', coin = rnd.chance(0.5), dw = lot.fence.driveway;
      // the gap for the driveway on the side with more room beside the house (by chance when they are alike)
      let s0 = Infinity, s1 = -Infinity; for (const [x, z] of ring) { const s = (x - px) * tx + (z - pz) * tz; s0 = Math.min(s0, s); s1 = Math.max(s1, s); }
      const atEnd = Math.abs((t1 - s1) - (s0 - t0)) > 1 ? t1 - s1 > s0 - t0 : coin;
      const [f0, f1] = atEnd ? [t0, t1 - dw] : [t0 + dw, t1];
      if (f1 > f0) fence(mb, L(f0, 0.15), L(f1, 0.15), kind, lot.fence);
      if (rnd.chance(lot.bins.chance)) { const dc = atEnd ? t1 - dw / 2 : t0 + dw / 2, spot = L(dc + (atEnd ? -1 : 1) * (dw / 2 + 1.2), 2.2); bins(mb, spot[0], spot[1], { x: tx, z: tz }, lot.bins); }
      if (lot.driveway && lot.driveway.chance > 0 && rnd.chance(lot.driveway.chance)) driveway(mb, { px, pz, tx, tz, nx, nz }, atEnd ? t1 - dw / 2 : t0 + dw / 2, ring, lots.get(k) ?? null, lot.driveway);
      return;
    }
    if (!near || !front || near.d > 70) return;
    // the front boundary: behind the footpath, along the street, across the house's frontage
    // the property line on the house's side of its street: the road's reserve there (data), or its verge by the rules
    const side = (cx - near.px) * -near.tz + (cz - near.pz) * near.tx > 0 ? 1 : -1, nx = -near.tz * side, nz = near.tx * side;
    const pr = near.seg.sec.profile, offs = pr.carriageway / 2 + vergeWidth(side > 0 ? pr.right : pr.left); if (near.d < offs + 2.5) return;
    let t0 = Infinity, t1 = -Infinity; for (const [x, z] of ring) { const s = (x - near.px) * near.tx + (z - near.pz) * near.tz; t0 = Math.min(t0, s); t1 = Math.max(t1, s); }
    t0 -= 1.5; t1 += 1.5;
    const L = (s: number, o: number): P2 => [near.px + near.tx * s + nx * o, near.pz + near.tz * s + nz * o];
    const lot = look.lot, kind = rnd.chance(lot.fence.chance) ? rnd.weighted(lot.fence.types) : 'none', atEnd = rnd.chance(0.5), dw = lot.fence.driveway;
    const [f0, f1] = atEnd ? [t0, t1 - dw] : [t0 + dw, t1];
    if (f1 > f0) fence(mb, L(f0, offs), L(f1, offs), kind, lot.fence);
    if (rnd.chance(lot.bins.chance)) { const dc = atEnd ? t1 - dw / 2 : t0 + dw / 2, spot = L(dc + (atEnd ? -1 : 1) * (dw / 2 + 1.2), offs + 2.2); bins(mb, spot[0], spot[1], { x: near.tx, z: near.tz }, lot.bins); }
  });
  // trees: footprints exclude them (no tree on a roof, a carriageway, a footpath or a junction); one a little on a road
  // or a footpath moves onto the verge (2 m at most), else it is left out
  for (const r of footprints) keep.addRing(r);
  const tr = t.trees, list = [];
  for (let i = 0; show('tree') && i + 3 < tr.length; i += 4) {
    // a baked tile's trees were placed by the bake (stage 14): as they are
    const at = t.baked ? [tr[i]! / 10, tr[i + 1]! / 10] : keep.place(tr[i]! / 10, tr[i + 1]! / 10, { r: 0.3, nudge: 2 }); if (!at) continue;
    const [x, z] = at as [number, number];
    const h = tr[i + 2]! / 10, r = tr[i + 3]! / 10;
    list.push({ x, z, height: h, radius: r, seed: t.tseeds?.[i / 4] ?? seedOf(t.ix, t.iz, i), id: newId({ kind: 'tree', id: `tree-${t.ix}-${t.iz}-${i / 4}`, props: { 'height (m)': h, 'crown radius (m)': r, ...placement(1, i / 4), source: src('trees') } }) });
  }
  // (v3) the bake's furniture and what it left out, for the app to draw as it likes
  const fu = t.furniture ?? [];
  if (fu.length) { extra.furniture = []; for (let i = 0; i + 4 < fu.length; i += 5) { const pl = placement(2, i / 5).placement; extra.furniture.push({ kind: str(fu[i]!), x: fu[i + 1]! / 10, z: fu[i + 2]! / 10, id: str(fu[i + 3]!), seed: fu[i + 4]!, ...(pl ? { patched: pl } : {}) }); } }
  if (t.omitted?.length) extra.omitted = t.omitted.map((m) => ({ what: (['building', 'plot', 'tree', 'furniture'] as const)[m[0]!] ?? 'building', x: m[1]! / 10, z: m[2]! / 10, check: str(m[3]!), id: str(m[4]!) }));
  // a tree's level by the pixels its crown covers (a grown tree is thousands of vertices: only the near ones whole)
  const grown = treeInstances(list, look.trees), instances = grown.map((x) => ({ shape: x.tree.levels, data: x.data, radius: x.tree.crownRadius * 0.8 }));
  return { chunk: { mesh: mb.build(), far: fb.build(), instances, info: (id) => infos[id] ?? null }, extra, infos, trees: grown.map((x) => ({ key: x.shape, data: x.data })) };
}

/** what a tile is built on, as numbers (it crosses to a worker): its place, and the ground under it (a grid, NaN where
 *  not known) */
export interface TilePlace { ix: number; iz: number; size: number; origin: [number, number]; at: [number, number]; step: number; n: number; heights: Float32Array }
/** the kinds a street level builds (setView shows some) */
export const CITY_KINDS = ['building', 'road', 'tree', 'park', 'water', 'waterway'] as const;
/** a tile's build as numbers (from a worker): the meshes, the trees by species key, what each id is */
export interface TileNumbers { mesh: Float32Array; far: Float32Array; trees: { key: string; data: Float32Array }[]; infos: SolidInfo[]; extra: CityExtra }
/** the functions a street level's worker offers (your worker module: workers.serve(streetsWorker(look))); also the
 *  main thread's fallback */
export function streetsWorker(lookIn: Partial<CityLook> = {}) {
  const look: CityLook = { ...CITY, ...lookIn };
  const ctxOf = (p: TilePlace): DetailContext => {
    const kx = 111320 * Math.cos(p.origin[1] * Math.PI / 180);
    return { ix: p.ix, iz: p.iz, size: p.size, origin: p.origin, at: p.at, lonLat: (x, z) => [p.origin[0] + (p.at[0] + x) / kx, p.origin[1] - (p.at[1] + z) / 110574],
      groundAt: (x, z) => { const gx = Math.max(0, Math.min(p.n - 1.001, x / p.step)), gz = Math.max(0, Math.min(p.n - 1.001, z / p.step)), i = Math.floor(gx), j = Math.floor(gz), fx = gx - i, fz = gz - j, h = (a: number, b: number) => p.heights[b * p.n + a]!; return (h(i, j) * (1 - fx) + h(i + 1, j) * fx) * (1 - fz) + (h(i, j + 1) * (1 - fx) + h(i + 1, j + 1) * fx) * fz; } };
  };
  const run = (t: CityTile, p: TilePlace, kinds: string[], sources: Record<string, { title: string; licence: string }>) => { const show = new Set(kinds); return cityTile(t, ctxOf(p), look, sources, (k) => show.has(k)); };
  return {
    build(t: CityTile, p: TilePlace, kinds: string[], sources: Record<string, { title: string; licence: string }>): TileNumbers { const r = run(t, p, kinds, sources); return { mesh: new Float32Array(0), far: r.chunk.far, trees: r.trees, infos: r.infos, extra: r.extra }; },
    whole(t: CityTile, p: TilePlace, kinds: string[], sources: Record<string, { title: string; licence: string }>): Float32Array { return run(t, p, kinds, sources).chunk.mesh; },
  };
}

export interface StreetsProps extends Omit<StreetDetailProps<CityTile, CityExtra>, 'build'> {
  look?: Partial<CityLook>;
  /** build the tiles in workers (core › runtime › workers) running your module with workers.serve(streetsWorker(look))
   *  (the same look): the frames keep coming while a tile is made */
  worker?: WorkerLane;
}
/** a city's street level: tiles of open data built round the camera; `.wires` is the layer of the power lines */
export class Streets extends StreetDetail<CityTile, CityExtra> {
  /** the wire spans of the tiles built now, as rows (lon / lat ends, height over the ground) */
  readonly spans = new Rows<WireDatum & { id: string }>([], { id: 'id' });
  /** the power lines: add it with the streets (w.add(st, st.wires)) */
  readonly wires;
  private dirtySpans = false;
  constructor(p: StreetsProps) {
    const look: CityLook = { ...CITY, ...p.look };
    let me: Streets | null = null;
    // the whole mesh only for the near chunks (built again when they come near: the far mesh holds the rest)
    const tile = (t: CityTile, ctx: DetailContext) => {
      // a baked tile's numbers as plain arrays here (the tile is read on this thread too: blockers, apps)
      decodeBuiltTile(t as unknown as Record<string, unknown>);
      const src = me?.area?.sources ?? {}, show = me?.showKind ?? (() => true);
      if (p.worker) {
        // in a worker: the tile and its ground there, the far mesh and the trees back; the whole mesh when it comes near
        const lane = p.worker, place = placeOf(ctx), kinds = CITY_KINDS.filter((k) => show(k)), sources = Object.fromEntries(Object.entries(src).map(([k, v]) => [k, { title: v.title, licence: v.licence }]));
        return lane.call<TileNumbers>('build', t, place, kinds, sources).then((r) => ({
          chunk: { mesh: () => lane.call<Float32Array>('whole', t, place, kinds, sources), far: r.far, instances: r.trees.map((x) => { const tr = treeShapes(look.trees).get(x.key); return { shape: tr?.levels ?? [], data: x.data, radius: (tr?.crownRadius ?? 4) * 0.8 }; }), info: (id: number) => r.infos[id] ?? null },
          extra: r.extra,
        }));
      }
      const r = cityTile(t, ctx, look, src, show);
      return { ...r, chunk: { ...r.chunk, mesh: () => cityTile(t, ctx, look, src, show).chunk.mesh } };
    };
    super({ lod: [130, 300], ...p, id: p.id ?? 'streets', build: tile, onTile: (k, e, c) => { me?.tileChanged(); p.onTile?.(k, e, c); } });
    me = this;
    this.wires = wires({ id: `${this.id}-wires`, data: this.spans, color: look.poles.wire, when: p.when ?? { level: { from: 'street' } } });
  }
  private tileChanged(): void { this.dirtySpans = true; }
  /** which kinds of things are built (a curated view): building, road, tree, park, water, waterway */
  showKind: (kind: string) => boolean = () => true;
  setView(show: (kind: string) => boolean): this { this.showKind = show; return this.rebuild(); }
  /** what stands at a place (m over the ground: a building's height; 0 open): kits › game › collision asks the world's
   *  layers this ('compiled'). Each tile's buildings become a 2 m height grid on first need */
  blockerAt(lon: number, lat: number): number {
    const ix0 = this.area; if (!ix0) return 0;
    const kx = 111320 * Math.cos((ix0.origin[1] * Math.PI) / 180), x = (lon - ix0.origin[0]) * kx, z = -(lat - ix0.origin[1]) * 110574;
    const ix = Math.floor(x / ix0.size), iz = Math.floor(z / ix0.size), key = `${ix}_${iz}`;
    let g = this.blockGrids.get(key);
    if (!g) {
      const t = this.tiles().find((b) => b.key === key); if (!t) return 0;
      const n = Math.ceil(ix0.size / 2), h = new Float32Array(n * n);
      decodeBuiltTile(t.tile as unknown as Record<string, unknown>);
      for (const bld of t.tile.buildings) {
        const ring = polyline(bld, 3), hh = bld[0]! / 10; if (ring.length < 3) continue;
        let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity; for (const [px, pz] of ring) { x0 = Math.min(x0, px); x1 = Math.max(x1, px); z0 = Math.min(z0, pz); z1 = Math.max(z1, pz); }
        for (let j = Math.max(0, Math.floor(z0 / 2)); j <= Math.min(n - 1, Math.floor(z1 / 2)); j++) for (let i = Math.max(0, Math.floor(x0 / 2)); i <= Math.min(n - 1, Math.floor(x1 / 2)); i++) if (inside(i * 2 + 1, j * 2 + 1, ring)) h[j * n + i] = Math.max(h[j * n + i]!, hh);
      }
      g = { n, h }; this.blockGrids.set(key, g);
      if (this.blockGrids.size > 40) this.blockGrids.delete(this.blockGrids.keys().next().value!);
    }
    const i = Math.floor((x - ix * ix0.size) / 2), j = Math.floor((z - iz * ix0.size) / 2);
    return i < 0 || j < 0 || i >= g.n || j >= g.n ? 0 : g.h[j * g.n + i]!;
  }
  private blockGrids = new Map<string, { n: number; h: Float32Array }>();
  override frame(ctx: Parameters<StreetDetail['frame']>[0]) {
    const out = super.frame(ctx);
    // the wires follow the tiles, once a frame at most
    if (this.dirtySpans) {
      this.dirtySpans = false;
      const rows: (WireDatum & { id: string })[] = [];
      for (const b of this.built()) b.extra?.spans.forEach((s, i) => rows.push({ id: `${b.key}:${i}`, a: b.ctx.lonLat(s.ax, s.az), b: b.ctx.lonLat(s.bx, s.bz), top: s.top }));
      this.spans.set(rows);
    }
    return out;
  }
}
export const streets = (p: Leveled<StreetsProps>) => new Streets(p as StreetsProps);
/** a tile's place and its ground (a 21 × 21 grid, 25 m) as numbers */
function placeOf(ctx: DetailContext): TilePlace {
  const n = 21, step = ctx.size / (n - 1), heights = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) heights[j * n + i] = ctx.groundAt(i * step, j * step);
  return { ix: ctx.ix, iz: ctx.iz, size: ctx.size, origin: ctx.origin, at: ctx.at, step, n, heights };
}
