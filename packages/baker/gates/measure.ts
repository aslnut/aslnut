// The gates, measured on a baked roads pack as aslnut reads it (bakedPieces, facets as drawn, the clamp over the
// pack's ground). One measure per defect group, after the read-only investigation's scripts (islands, k-c, k-scan,
// k-gap, k-e, k-walls, seams, k-h, k-zebra), so an old pack and a new one are measured by the same code:
//   B  islands and medians: verge pieces between kerbs whose surface rises over the nearest kerb top by > 10 cm
//   C  kerb outlines: jogs (a short step between near-parallel kerb) and folds (the kerb's top turned over)
//   D  scraps and slivers: bare strips between a kerb and its verge (m of kerb); footpath bits under 25 m²
//   E  bites: kerb along which the footpath beside it is under 1 m wide (m)
//   F  pits and walls: footpath facets steeper than 1:4 (as drawn); property line standing > 0.5 m over the ground
//   G  seams: carriageway piece boundaries inside the road with a gap > 2 mm or a step > 1 cm (m)
//   H  dashes through junctions: lane markings lying across another road's carriageway at an angle
//   I  zebras without a kerb ramp at each end
//   node packages/baker/gates/measure.ts <pack dir> <place geojson> [x0 z0 x1 z1] > result.json
//   ASLNUT_SRC: the aslnut source whose reading is measured (default this tree's; run.sh uses main's snapshot)
import { readFileSync, existsSync } from 'node:fs';
import { relative, resolve } from 'node:path';
const SRC = resolve(process.env.ASLNUT_SRC ?? `${import.meta.dirname}/../../aslnut/src`);
const { bakedPieces } = await import(`${SRC}/modules/world/earth/presets/built/roads/baked.ts`);
const { facetsOf, FacetIndex } = await import(`${SRC}/core/geometry/networks/facets.ts`);
const { clampIndex } = await import(`${SRC}/core/geometry/networks/clamp-index.ts`);
const { decodeNumbers } = await import(`${SRC}/core/data/loading/chunks/numbers.ts`);
type Facet = any;

const [DIR0, GEO, ...boxArgs] = process.argv.slice(2);
const DIR = DIR0.endsWith('/') ? DIR0 : DIR0 + '/';
const index = JSON.parse(readFileSync(DIR + 'index.json', 'utf8'));
const O = index.origin as [number, number], KX = 111320 * Math.cos(O[1] * Math.PI / 180), KZ = 110574;
const ll = (x: number, z: number) => [+(O[0] + x / KX).toFixed(6), +(O[1] - z / KZ).toFixed(6)];
const xz = (lon: number, lat: number) => [(lon - O[0]) * KX, -(lat - O[1]) * KZ];
const [X0, Z0, X1, Z1] = boxArgs.length === 4 ? boxArgs.map(Number) : [-Infinity, -Infinity, Infinity, Infinity];
const inBox = (x: number, z: number) => x >= X0 && x <= X1 && z >= Z0 && z <= Z1;
const T0 = performance.now();
const log = (s: string) => process.stderr.write(`${((performance.now() - T0) / 1000).toFixed(1)} s ${s}\n`);
class G<T> {
  m = new Map<string, T[]>(); c: number; constructor(c = 10) { this.c = c; }
  add(x0: number, z0: number, x1: number, z1: number, v: T) { for (let i = Math.floor(x0 / this.c); i <= Math.floor(x1 / this.c); i++) for (let j = Math.floor(z0 / this.c); j <= Math.floor(z1 / this.c); j++) { const k = i + ',' + j; let a = this.m.get(k); if (!a) this.m.set(k, (a = [])); a.push(v); } }
  near(x: number, z: number, r: number): T[] { const s = new Set<T>(); for (let i = Math.floor((x - r) / this.c); i <= Math.floor((x + r) / this.c); i++) for (let j = Math.floor((z - r) / this.c); j <= Math.floor((z + r) / this.c); j++) for (const v of this.m.get(i + ',' + j) ?? []) s.add(v); return [...s]; }
}
const ringArea = (r: number[][]) => { let a = 0; for (let i = 0; i < r.length; i++) { const p = r[i]!, q = r[(i + 1) % r.length]!; a += p[0]! * q[1]! - q[0]! * p[1]!; } return a / 2; };
const segX = (a: number[], b: number[], c: number[], d: number[]) => { const o = (p: number[], q: number[], r: number[]) => (q[0]! - p[0]!) * (r[1]! - p[1]!) - (q[1]! - p[1]!) * (r[0]! - p[0]!); const d1 = o(c, d, a), d2 = o(c, d, b), d3 = o(a, b, c), d4 = o(a, b, d); return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0)); };
const sd = (x: number, z: number, a: number[], b: number[]) => { const dx = b[0]! - a[0]!, dz = b[1]! - a[1]!, t = Math.max(0, Math.min(1, ((x - a[0]!) * dx + (z - a[1]!) * dz) / (dx * dx + dz * dz || 1))); return Math.hypot(x - a[0]! - dx * t, z - a[1]! - dz * t); };

// a strip (lines side by side) as an outline: its first line, then its last back (quads between, as drawn)
const ringsOf = (p: any): number[][][] => p.t === 'area' ? p.rings : p.t === 'strip' ? [[...p.edges[0], ...p.edges[p.edges.length - 1].slice().reverse()]] : [];
const surface = (p: any) => (p.t === 'area' || p.t === 'strip') && !p.overhead;
// ── the pack ──
type AnyPiece = any;
const pieces: AnyPiece[] = [];
for (const [ix, iz] of index.tiles as [number, number][]) {
  const f = `${DIR}${ix}_${iz}.json`; if (!existsSync(f)) continue;
  const t = JSON.parse(readFileSync(f, 'utf8'));
  for (const p of bakedPieces(t, index.kinds)) {
    const pts = p.t === 'area' ? p.rings[0] : p.t === 'poly' ? p.ring : p.t === 'strip' ? p.edges[0] : p.t === 'wall' ? p.line : p.t === 'edge' ? p.pts : [p.at];
    let cx = 0, cz = 0; for (const q of pts as number[][]) { cx += q[0]! / pts.length; cz += q[1]! / pts.length; }
    if (!inBox(cx, cz)) continue;
    pieces.push(Object.assign(p, { props: t.infos[p.info]?.props ?? {} }));
  }
}
log(`${pieces.length} pieces`);
const areas = pieces.filter((p) => surface(p) && ['carriageway', 'footpath', 'verge'].includes(p.kind));
const fi = new FacetIndex(facetsOf(areas), 10);
const edges = pieces.filter((p) => p.t === 'edge');
const kerbTops: Facet[] = [];
for (const p of edges) { if (p.kind !== 'kerb' && p.kind !== 'ramp') continue; const up = p.kind === 'kerb' ? 0.15 : 0.02; const P = p.pts; for (let i = 0; i + 1 < P.length; i++) { const a = P[i], b = P[i + 1]; const q = (x: number, z: number, h: number) => [x, z, h + up] as [number, number, number]; kerbTops.push(...facetsOf([{ t: 'poly', kind: p.kind, info: p.info, fan: false, ring: [q(a[0], a[1], a[2]), q(b[0], b[1], b[2]), q(b[0] + b[4], b[1] + b[5], b[2]), q(a[0] + a[4], a[1] + a[5], a[2])] } as any])); } }
const ki = new FacetIndex(kerbTops, 10);
const clampHead = JSON.parse(readFileSync(DIR + 'clamp.json', 'utf8'));
const T = JSON.parse(readFileSync(DIR + 'terrain.json', 'utf8')); const td = decodeNumbers(T.numeric, 100)[0]!;
const baked = (x: number, z: number) => { const fx = (x - T.x0) / T.step, fz = (z - T.z0) / T.step; if (fx < 0 || fz < 0 || fx >= T.nx - 1 || fz >= T.nz - 1) return NaN; const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j, q = j * T.nx + i; return (td[q]! * (1 - u) + td[q + 1]! * u) * (1 - v) + (td[q + T.nx]! * (1 - u) + td[q + T.nx + 1]! * u) * v; };
const clamps = new Map<string, any>();
const clampAt = (x: number, z: number) => { const k = `${Math.floor(x / 500)}_${Math.floor(z / 500)}`; if (!clamps.has(k)) { const f = `${DIR}clamp/${k}.json`; clamps.set(k, existsSync(f) ? clampIndex({ ...JSON.parse(readFileSync(f, 'utf8')), origin: clampHead.origin }) : null); } return clamps.get(k); };
const ground = (x: number, z: number) => { const b = baked(x, z), c = clampAt(x, z)?.limit(x, z, 0.5, 14, 1); return c == null ? b : Math.min(b, c); };
const cover = (x: number, z: number) => { let best: { kind: string; h: number } | null = null; for (const f of ki.at(x, z)) { const h = f.height(x, z); if (!best || h > best.h) best = { kind: f.piece.kind, h }; } for (const f of fi.at(x, z)) { const h = f.height(x, z); if (!best || h > best.h) best = { kind: f.piece.kind, h }; } return best; };
log('indexed');
// (the pack's path relative to where it runs: a result names no machine's folders)
const out: Record<string, unknown> = { pack: relative(process.cwd(), DIR) + '/', box: [X0, Z0, X1, Z1], pieces: pieces.length };
// (ONLY=B,F measures only those groups)
const ONLY = (process.env.ONLY ?? 'B,C,D,E,F,G,H,I').split(',');
const want = (g: string) => ONLY.includes(g);

// ── B: islands and medians (islands.ts) ──
if (want('B')) {
  // kerb inner-line points every 0.25 m with the kerb top (as islands.ts), in 1 m cells searched ring by ring
  const KC = 1, kg = new Map<string, number[][]>();
  for (const p of edges) if (p.kind === 'kerb' || p.kind === 'ramp') for (let i = 0; i + 1 < p.pts.length; i++) {
    const a = p.pts[i], b = p.pts[i + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.ceil(L / 0.25)), up = p.kind === 'kerb' ? 0.15 : 0.02;
    for (let k = 0; k <= n; k++) for (const w of [0, 1]) { const t = k / n, x = a[0] + w * a[4] + (b[0] + w * b[4] - a[0] - w * a[4]) * t, z = a[1] + w * a[5] + (b[1] + w * b[5] - a[1] - w * a[5]) * t, h = a[2] + (b[2] - a[2]) * t + up, key = `${Math.floor(x / KC)},${Math.floor(z / KC)}`; (kg.get(key) ?? kg.set(key, []).get(key)!).push([x, z, h]); }
  }
  // the nearest kerb top point, and the nearest on the other side (more than 90 degrees round), within R; the
  // reference height between them weighted by distance (the same answer as islands.ts, found ring by ring)
  const nearest = (x: number, z: number, R = 30) => {
    const cx = Math.floor(x / KC), cz = Math.floor(z / KC), rmax = Math.ceil(R / KC);
    let best = Infinity, bh = NaN, bq: number[] | null = null; const seen: number[][] = [];
    let r = 0;
    for (; r <= rmax; r++) {
      for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) { if (Math.max(Math.abs(i), Math.abs(j)) !== r) continue; for (const q of kg.get(`${cx + i},${cz + j}`) ?? []) { seen.push(q); const d = Math.hypot(q[0]! - x, q[1]! - z); if (d <= R && d < best) { best = d; bh = q[2]!; bq = q; } } }
      if (bq && (r - 1) * KC > best) break;
    }
    if (!bq) return [Infinity, NaN, NaN];
    let b2 = Infinity, h2 = NaN;
    const opp = (q: number[]) => { const d = Math.hypot(q[0]! - x, q[1]! - z); if (d <= R && (q[0]! - x) * (bq![0]! - x) + (q[1]! - z) * (bq![1]! - z) < 0 && d < b2) { b2 = d; h2 = q[2]!; } };
    for (const q of seen) opp(q);
    for (r = r + 1; r <= rmax; r++) {
      if ((r - 1) * KC > b2) break;
      for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) { if (Math.max(Math.abs(i), Math.abs(j)) !== r) continue; for (const q of kg.get(`${cx + i},${cz + j}`) ?? []) opp(q); }
    }
    const ref = Number.isFinite(b2) ? (bh * b2 + h2 * best) / (best + b2) : bh; return [best, bh, ref];
  };
  let medians = 0, humps = 0, bigHumps = 0, rimSteps = 0; const rows: any[] = [];
  for (const p of pieces) {
    if (!surface(p) || p.kind !== 'verge') continue;
    const ring = ringsOf(p)[0]!;
    // (only whether a kerb point lies within 0.3 m matters here: searched that far)
    const near = ring.map((q: number[]) => nearest(q[0]!, q[1]!, 0.3)), onKerb = near.filter((n: number[]) => n[0]! < 0.3).length / ring.length;
    if (onKerb < 0.6) continue;
    medians++;
    let rim = 0; ring.forEach((q: number[], i: number) => { if (near[i][0] < 0.3 && Math.abs(q[2]! - near[i][1]) > rim) rim = Math.abs(q[2]! - near[i][1]); });
    let hump = 0, hx = 0, hz = 0;
    // (every 0.5 m along a facet's longest edge, at most 40 rows: a long thin facet is not sampled by the square)
    for (const f of facetsOf([p])) { const [a, b, c] = f.points, L = Math.max(Math.hypot(a[0] - b[0], a[1] - b[1]), Math.hypot(a[0] - c[0], a[1] - c[1]), Math.hypot(b[0] - c[0], b[1] - c[1])), n = Math.min(40, Math.max(1, Math.ceil(L / 0.5)));
      for (let i = 0; i < n; i++) for (let j = 0; j < n - i; j++) { const u = (i + 1 / 3) / n, v = (j + 1 / 3) / n, x = a[0] * (1 - u - v) + b[0] * u + c[0] * v, z = a[1] * (1 - u - v) + b[1] * u + c[1] * v, [d, , kh] = nearest(x, z, 12); if (!Number.isFinite(d)) continue; const s = f.height(x, z) - kh!; if (s > hump) { hump = s; hx = x; hz = z; } } }
    if (hump > 0.1) humps++; if (hump > 0.3) bigHumps++; if (rim > 0.05) rimSteps++;
    rows.push({ at: ll(hx, hz), hump: +hump.toFixed(2) });
  }
  rows.sort((a, b) => b.hump - a.hump);
  out.B = { islandsAndMedians: medians, over10cm: humps, over30cm: bigHumps, rimOffKerbTop5cm: rimSteps, worst: rows.slice(0, 5) };
  log('B');
}
// ── C: kerb jogs and folds (k-c.ts) ──
if (want('C')) {
  const turn = (a: number[], b: number[], c: number[]) => { const u = [b[0]! - a[0]!, b[1]! - a[1]!], v = [c[0]! - b[0]!, c[1]! - b[1]!]; return Math.atan2(u[0]! * v[1]! - u[1]! * v[0]!, u[0]! * v[0]! + u[1]! * v[1]!) * 180 / Math.PI; };
  const L = (a: number[], b: number[]) => Math.hypot(b[0]! - a[0]!, b[1]! - a[1]!);
  let pts = 0, spikes = 0, jogs = 0, folds = 0, reversed = 0, innerCross = 0; const jogAt: any[] = [], foldAt: any[] = [];
  for (const p of edges) {
    if (p.kind !== 'kerb' && p.kind !== 'ramp') continue;
    const P = p.pts as number[][], n = P.length; pts += n;
    for (let i = 1; i + 1 < n; i++) {
      const t = turn(P[i - 1]!, P[i]!, P[i + 1]!), l1 = L(P[i - 1]!, P[i]!), l2 = L(P[i]!, P[i + 1]!);
      if (Math.abs(t) > 120 && Math.min(l1, l2) < 1.5) spikes++;
      if (i + 2 < n) { const t2 = turn(P[i]!, P[i + 1]!, P[i + 2]!), lm = L(P[i]!, P[i + 1]!); if (lm < 1.2 && lm > 0.02 && Math.abs(t) > 35 && Math.abs(t2) > 35 && Math.sign(t) !== Math.sign(t2) && Math.abs(t + t2) < 25) { jogs++; if (jogAt.length < 5) jogAt.push(ll(P[i]![0]!, P[i]![1]!)); } }
    }
    for (let i = 0; i + 1 < n; i++) {
      const a = P[i]!, b = P[i + 1]!, ai = [a[0]! + a[4]!, a[1]! + a[5]!], bi = [b[0]! + b[4]!, b[1]! + b[5]!];
      if (segX(a, ai, b, bi)) { folds++; if (foldAt.length < 5) foldAt.push(ll(a[0]!, a[1]!)); }
      else if ((bi[0]! - ai[0]!) * (b[0]! - a[0]!) + (bi[1]! - ai[1]!) * (b[1]! - a[1]!) < 0) reversed++;
    }
    const I = P.map((q) => [q[0]! + q[4]!, q[1]! + q[5]!]);
    for (let i = 0; i + 1 < n; i++) for (let j = i + 2; j + 1 < n && j < i + 12; j++) if (segX(I[i]!, I[i + 1]!, I[j]!, I[j + 1]!)) innerCross++;
  }
  out.C = { kerbPoints: pts, jogs, folds, spikes, reversedTops: reversed, innerCrossings: innerCross, jogAt, foldAt };
  log('C');
}
// ── D, E and the ground over verges: rays out from every kerb across the verge (k-scan.ts, k-e.ts) ──
if (want('D')) {
  let rays = 0, kerbLen = 0, sliverLen = 0, holeLen = 0, sunkLen = 0, biteLen = 0, rampSteps = 0, rampOk = 0, rampNoPath = 0, fpRays = 0, fpThinLen = 0;
  const sliverAt: any[] = [], thinAt: any[] = [], biteAt: any[] = [];
  for (const p of edges) {
    if (p.kind !== 'kerb' && p.kind !== 'ramp') continue;
    const P = p.pts;
    for (let i = 0; i + 1 < P.length; i++) {
      const a = P[i], b = P[i + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L < 0.05) continue;
      const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2, h = (a[2] + b[2]) / 2;
      let ox = -(a[4] + b[4]) / 2, oz = -(a[5] + b[5]) / 2; const ol = Math.hypot(ox, oz) || 1; ox /= ol; oz /= ol;
      rays++; kerbLen += L;
      const seq: { t: number; c: { kind: string; h: number } | null }[] = [];
      for (let t = 0.1; t <= 6; t += 0.2) seq.push({ t, c: cover(mx + ox * t, mz + oz * t) });
      const top = h + (p.kind === 'kerb' ? 0.15 : 0.02), first = seq[0]!.c;
      if (p.kind === 'ramp') { const s = seq.slice(0, 4).find((q) => q.c && (q.c.kind === 'footpath' || q.c.kind === 'verge')); if (!s) rampNoPath++; else if (s.c!.h - top > 0.08) rampSteps++; else rampOk++; }
      const covered = (q: { c: { kind: string } | null }) => !!q.c && q.c.kind !== 'carriageway';
      const firstCov = seq.findIndex((q) => !!q.c && (q.c.kind === 'footpath' || q.c.kind === 'verge'));
      if (firstCov > 0 && seq.slice(0, firstCov).every((q) => !q.c) && seq[firstCov]!.t <= 2.2) { sliverLen += L; if (sliverAt.length < 5) sliverAt.push(ll(mx, mz)); }
      for (let k = 1; k + 1 < seq.length; k++) if (!seq[k]!.c && covered(seq[k - 1]!) && seq.slice(k + 1, k + 6).some(covered)) { holeLen += L; break; }
      if (first && (first.kind === 'footpath' || first.kind === 'verge') && p.kind === 'kerb' && first.h - top < -0.05) sunkLen += L;
      for (const q of seq) { if (!q.c || (q.c.kind !== 'footpath' && q.c.kind !== 'verge')) continue; const x = mx + ox * q.t, z = mz + oz * q.t, g = ground(x, z); if (g > q.c.h + 0.01) { biteLen += L; if (biteAt.length < 8 && Math.random() < 0.05) biteAt.push([...ll(x, z), +q.t.toFixed(1), +(g - q.c.h).toFixed(2)]); break; } }
      // E: the footpath band crossed by the ray (within 8 m)
      if (p.kind === 'kerb') {
        let s0 = -1, s1 = -1;
        for (let t = 0.05; t <= 8; t += 0.1) { const c = cover(mx + ox * t, mz + oz * t); const f = !!c && c.kind === 'footpath'; if (f && s0 < 0) s0 = t; if (!f && s0 >= 0) { s1 = t; break; } }
        if (s0 >= 0 && s1 >= 0) { fpRays++; if (s1 - s0 < 1.0) { fpThinLen += L; if (thinAt.length < 5) thinAt.push(ll(mx, mz)); } }
      }
    }
  }
  // footpath bits under 25 m² (k-gap.ts): pieces joined where they share points
  const key = (q: number[]) => `${Math.round(q[0]! * 50)},${Math.round(q[1]! * 50)}`;
  const fp = pieces.filter((p) => surface(p) && p.kind === 'footpath').map((p) => ({ rings: ringsOf(p) })), parent = fp.map((_, i) => i), find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  const byKey = new Map<string, number>();
  fp.forEach((p, i) => { for (const r of p.rings) for (const q of r) { const k = key(q), j = byKey.get(k); if (j === undefined) byKey.set(k, i); else parent[find(i)] = find(j); } });
  const comps = new Map<number, number[]>(); fp.forEach((_, i) => { const r = find(i); comps.set(r, [...(comps.get(r) ?? []), i]); });
  let small = 0; const smallAt: any[] = []; for (const [, ids] of comps) { let A = 0; for (const i of ids) A += Math.abs(ringArea(fp[i]!.rings[0])) - fp[i]!.rings.slice(1).reduce((s: number, r: number[][]) => s + Math.abs(ringArea(r)), 0); if (A < 25) { small++; if (smallAt.length < 8) { const q = fp[ids[0]!]!.rings[0][0]; smallAt.push([...ll(q[0], q[1]), +A.toFixed(1)]); } } }
  out.D = { kerbKm: +(kerbLen / 1000).toFixed(1), sliverAlongKerbM: Math.round(sliverLen), holesAlongKerbM: Math.round(holeLen), footpathBits: comps.size, footpathBitsUnder25m2: small, sliverAt, smallAt };
  out.E = { footpathRays: fpRays, footpathUnder1mAlongKerbM: Math.round(fpThinLen), thinAt };
  out.groundOverVerge = { biteAt, alongKerbM: Math.round(biteLen), verge_belowKerbTopM: Math.round(sunkLen), ramps: { ok: rampOk, stepOver8cm: rampSteps, noPath: rampNoPath } };
  log('D E');
}
// ── F: steep footpath facets as drawn; the property line's wall (k-walls.ts) ──
if (want('F')) {
  let facets = 0, steep = 0, steepM2 = 0;
  for (const f of facetsOf(pieces.filter((p) => surface(p) && p.kind === 'footpath'))) {
    const [a, b, c] = f.points, den = (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]); if (Math.abs(den) < 1e-8) continue;
    const gx = ((b[2] - a[2]) * (c[1] - a[1]) - (c[2] - a[2]) * (b[1] - a[1])) / den, gz = ((b[0] - a[0]) * (c[2] - a[2]) - (c[0] - a[0]) * (b[2] - a[2])) / den;
    facets++; if (Math.hypot(gx, gz) > 0.25) { steep++; steepM2 += Math.abs(den) / 2; }
  }
  const fv = pieces.filter((p) => surface(p) && (p.kind === 'verge' || p.kind === 'footpath'));
  const vi = new FacetIndex(facetsOf(fv), 10);
  let len = 0, w15 = 0, w50 = 0; const wallAt: any[] = [], wall15At: any[] = [];
  for (const p of edges) {
    if (p.kind !== 'edge' || !['nature strip', 'property line'].includes(p.props.what)) continue;
    for (let i = 0; i + 1 < p.pts.length; i++) {
      const a = p.pts[i], b = p.pts[i + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L < 0.05) continue;
      const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2, nx = -(b[1] - a[1]) / L, nz = (b[0] - a[0]) / L, h = (a[2] + b[2]) / 2;
      const s1 = vi.at(mx + nx * 0.3, mz + nz * 0.3).length > 0, s2 = vi.at(mx - nx * 0.3, mz - nz * 0.3).length > 0; if (s1 === s2) continue;
      const o = s1 ? -1 : 1, g = ground(mx + nx * 0.3 * o, mz + nz * 0.3 * o), wall = h - g; len += L;
      if (wall > 0.15) { w15 += L; if (wall15At.length < 2000 && Math.random() < 0.02) wall15At.push([...ll(mx, mz), +wall.toFixed(2), +h.toFixed(2), +g.toFixed(2)]); } if (wall > 0.5) { w50 += L; if (wallAt.length < 400) wallAt.push([...ll(mx, mz), +wall.toFixed(2), +h.toFixed(2), +g.toFixed(2)]); }
    }
  }
  out.F = { footpathFacets: facets, steeperThan1in4: steep, steepM2: Math.round(steepM2), propertyLineKm: +(len / 1000).toFixed(1), wallOver15cmM: Math.round(w15), wallOver50cmM: Math.round(w50), wallAt: wallAt.sort((a, b) => b[2] - a[2]).slice(0, 8), wall15At: wall15At.slice(0, 8) };
  log('F');
}
// ── G: seams between carriageway pieces (seams.ts) ──
if (want('G')) {
  const roads = pieces.filter((p) => p.kind === 'carriageway' && surface(p));
  const fr = new FacetIndex(facetsOf(roads), 10);
  const eg = new Map<string, number[][]>();
  for (const p of edges) for (let i = 0; i + 1 < p.pts.length; i++) { const a = p.pts[i], b = p.pts[i + 1]; const k = `${Math.floor((a[0] + b[0]) / 20)},${Math.floor((a[1] + b[1]) / 20)}`; (eg.get(k) ?? eg.set(k, []).get(k)!).push([a[0], a[1], b[0], b[1]]); }
  const nearEdgeLine = (x: number, z: number) => { const cx = Math.floor(x / 10), cz = Math.floor(z / 10); for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const s of eg.get(`${cx + i},${cz + j}`) ?? []) { const dx = s[2]! - s[0]!, dz = s[3]! - s[1]!, L2 = dx * dx + dz * dz || 1, t = Math.max(0, Math.min(1, ((x - s[0]!) * dx + (z - s[1]!) * dz) / L2)); if (Math.hypot(x - s[0]! - dx * t, z - s[1]! - dz * t) < 0.05) return true; } return false; };
  let seamLen = 0, gapLen = 0, stepLen = 0, worstStep = 0; const STEP = 0.25; const stepAt: any[] = [];
  for (const p of roads) for (const ring of ringsOf(p)) for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L < 1e-3) continue;
    const nx = -(b[1] - a[1]) / L, nz = (b[0] - a[0]) / L, n = Math.max(1, Math.round(L / STEP));
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n, x = a[0] + (b[0] - a[0]) * t, z = a[1] + (b[1] - a[1]) * t, h = a[2] + (b[2] - a[2]) * t;
      if (nearEdgeLine(x, z)) continue;
      let found = false, gap = Infinity, dh = 0;
      for (const s of [1, -1]) for (const d of [0.002, 0.01, 0.03]) { const qx = x + nx * d * s, qz = z + nz * d * s; for (const f of fr.at(qx, qz)) if (f.piece !== p) { found = true; gap = Math.min(gap, d); dh = Math.max(dh, Math.abs(f.height(qx, qz) - h)); } }
      if (!found) { let any = false; for (const s of [1, -1]) for (const f of fr.at(x + nx * 0.3 * s, z + nz * 0.3 * s)) if (f.piece !== p) any = true; if (!any) continue; gapLen += L / n; continue; }
      seamLen += L / n;
      if (gap > 0.002) gapLen += L / n;
      if (dh > 0.01) { stepLen += L / n; worstStep = Math.max(worstStep, dh); if (stepAt.length < 5 && dh > 0.05) stepAt.push([...ll(x, z), +dh.toFixed(2)]); }
    }
  }
  out.G = { interiorSeamM: Math.round(seamLen), gapOver2mmM: Math.round(gapLen), stepOver1cmM: Math.round(stepLen), worstStepM: +worstStep.toFixed(2), stepAt };
  log('G');
}
// ── H: lane dashes across another road's carriageway (k-h.ts) ──
if (want('H')) {
  const geo = JSON.parse(readFileSync(GEO, 'utf8'));
  const width = new Map<string, number>();
  for (const p of pieces) if (p.props?.osm && p.props['carriageway (m)']) for (const id of String(p.props.osm).split(' ')) width.set(id, p.props['carriageway (m)']);
  const segs = new G<{ a: number[]; b: number[]; id: string; name: string; half: number }>(20);
  for (const f of geo.features) {
    if (f.geometry.type !== 'LineString') continue; const id = String(f.properties.osm_id), half = (width.get(id) ?? 0) / 2; if (!half) continue;
    const P = f.geometry.coordinates.map((c: number[]) => xz(c[0]!, c[1]!));
    for (let i = 0; i + 1 < P.length; i++) { const a = P[i], b = P[i + 1]; segs.add(Math.min(a[0], b[0]) - half, Math.min(a[1], b[1]) - half, Math.max(a[0], b[0]) + half, Math.max(a[1], b[1]) + half, { a, b, id, name: f.properties.name ?? '', half }); }
  }
  const marks = pieces.filter((p) => p.t === 'poly' && p.kind === 'marking');
  let dashes = 0, across = 0; const cells = new Set<string>(); const at: any[] = [];
  for (const m of marks) {
    const R = m.ring as number[][], n = R.length; let cx = 0, cz = 0; for (const q of R) { cx += q[0]! / n; cz += q[1]! / n; }
    let sxx = 0, szz = 0, sxz = 0; for (const q of R) { const dx = q[0]! - cx, dz = q[1]! - cz; sxx += dx * dx; szz += dz * dz; sxz += dx * dz; }
    const ang = 0.5 * Math.atan2(2 * sxz, sxx - szz), tx = Math.cos(ang), tz = Math.sin(ang);
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity; for (const q of R) { const u = (q[0]! - cx) * tx + (q[1]! - cz) * tz, v = -(q[0]! - cx) * tz + (q[1]! - cz) * tx; u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
    const len = u1 - u0, wid = v1 - v0; if (!(wid < 0.2 && len >= 0.8 && len <= 3.1)) continue;
    dashes++;
    const own = String(m.props.osm ?? '').split(' '), ownName = m.props.name ?? '';
    const hit = segs.near(cx, cz, 1).find((s) => { if (own.includes(s.id) || (ownName && s.name === ownName)) return false; const d = sd(cx, cz, s.a, s.b); if (d > s.half - 0.3) return false; const sx = s.b[0]! - s.a[0]!, sz = s.b[1]! - s.a[1]!, sl = Math.hypot(sx, sz) || 1, cos = Math.abs((sx * tx + sz * tz) / sl); return cos < Math.cos(25 * Math.PI / 180); });
    if (hit) { across++; cells.add(`${Math.round(cx / 40)},${Math.round(cz / 40)}`); if (at.length < 5) at.push(ll(cx, cz)); }
  }
  out.H = { dashes, dashesAcrossAnotherRoad: across, junctions: cells.size, at };
  log('H');
}
// ── I: zebras and their kerb ramps (k-zebra.ts) ──
if (want('I')) {
  const stripes: { cx: number; cz: number; tx: number; tz: number }[] = [];
  for (const m of pieces) {
    if (m.t !== 'poly' || m.kind !== 'marking') continue;
    const R = m.ring as number[][], n = R.length; let cx = 0, cz = 0; for (const q of R) { cx += q[0]! / n; cz += q[1]! / n; }
    let sxx = 0, szz = 0, sxz = 0; for (const q of R) { const dx = q[0]! - cx, dz = q[1]! - cz; sxx += dx * dx; szz += dz * dz; sxz += dx * dz; }
    const ang = 0.5 * Math.atan2(2 * sxz, sxx - szz), tx = Math.cos(ang), tz = Math.sin(ang);
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity; for (const q of R) { const u = (q[0]! - cx) * tx + (q[1]! - cz) * tz, v = -(q[0]! - cx) * tz + (q[1]! - cz) * tx; u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
    if (v1 - v0 > 0.5 && v1 - v0 < 0.7 && u1 - u0 > 1.0 && u1 - u0 < 3.1) stripes.push({ cx, cz, tx, tz });
  }
  const parent = stripes.map((_, i) => i), find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  const g = new G<number>(5); stripes.forEach((s, i) => g.add(s.cx, s.cz, s.cx, s.cz, i));
  stripes.forEach((s, i) => { for (const j of g.near(s.cx, s.cz, 1.6)) if (j !== i && Math.hypot(stripes[j]!.cx - s.cx, stripes[j]!.cz - s.cz) < 1.5) parent[find(i)] = find(j); });
  const groups = new Map<number, number[]>(); stripes.forEach((_, i) => { const r = find(i); groups.set(r, [...(groups.get(r) ?? []), i]); });
  const ramps = new G<number[]>(5);
  for (const p of edges) if (p.kind === 'ramp') for (const q of p.pts) ramps.add(q[0], q[1], q[0], q[1], q);
  let zebras = 0, both = 0, one = 0, none = 0; const bad: any[] = [];
  for (const [, ids] of groups) {
    if (ids.length < 3) continue; zebras++;
    const s0 = stripes[ids[0]!]!, ax = -s0.tz, az = s0.tx; let w0 = Infinity, w1 = -Infinity, cx = 0, cz = 0;
    for (const i of ids) { cx += stripes[i]!.cx / ids.length; cz += stripes[i]!.cz / ids.length; }
    for (const i of ids) { const w = (stripes[i]!.cx - cx) * ax + (stripes[i]!.cz - cz) * az; w0 = Math.min(w0, w); w1 = Math.max(w1, w); }
    const ends = [[cx + ax * (w0 - 0.8), cz + az * (w0 - 0.8)], [cx + ax * (w1 + 0.8), cz + az * (w1 + 0.8)]];
    const ok = ends.map((e) => ramps.near(e[0]!, e[1]!, 3).some((q) => Math.hypot(q[0]! - e[0]!, q[1]! - e[1]!) < 2.5));
    const k = ok.filter(Boolean).length; if (k === 2) both++; else if (k === 1) one++; else { none++; }
    if (k < 2 && bad.length < 5) bad.push(ll(cx, cz));
  }
  out.I = { stripes: stripes.length, zebras, bothEndsRamped: both, oneEnd: one, noRamp: none, withoutRampAtEachEnd: one + none, at: bad };
  log('I');
}
console.log(JSON.stringify(out));
