// modules › world › earth › presets › built › roads: roads as built solids. Sections: the carriageway by class, its real width, lane
// markings on the bigger roads; sidewalks: kerb and channel, a nature strip, a footpath on both sides of town streets.
// Everything follows the ground at every vertex; a bigger road lies over a smaller one where they meet.
//   roadSection(mb, pts, { cls: 5, width: 7.5 })        sidewalks(mb, pts, { cls: 5, width: 7.5 }, STREET)
import type { MeshBuilder } from '../../../../../../core/geometry/shapes/mesh.ts';
import { densify, type P2 } from '../../../shared/plan.ts';

/** a road class (0 freeway, 1 highway, 2 arterial, 3 sub-arterial, 4 collector, 5 local, 6+ tracks and lanes) */
export interface RoadSpec { cls: number; width: number }
export const ROAD_CLASS = ['Freeway', 'Highway', 'Arterial road', 'Sub-arterial road', 'Collector road', 'Local street', 'Track', 'Track', 'Lane', 'Lane'] as const;
export interface StreetLook {
  /** kerb and channel, nature strip, footpath, the strip on arterials (m) */
  kerb: number; strip: number; footpath: number; arterialStrip: number;
  kerbColor: string; stripColor: string; footpathColor: string;
  /** asphalt by class, tracks */
  asphalt: [string, string, string]; track: string; marking: string;
}
export const STREET: StreetLook = {
  kerb: 0.45, strip: 3.0, footpath: 1.4, arterialStrip: 1.5, kerbColor: '#b7b4ab', stripColor: '#6e9b46', footpathColor: '#cfcbc1',
  asphalt: ['#34373c', '#3b3e43', '#45484d'], track: '#8a8473', marking: '#e8e6df',
};
const asphaltOf = (cls: number, l: StreetLook) => (cls <= 1 ? l.asphalt[0] : cls <= 3 ? l.asphalt[1] : cls <= 5 ? l.asphalt[2] : l.track);

/** the carriageway, and dashed lane lines on roads of class 4 and bigger */
/** `far`: the carriageway alone, in longer pieces (far away) */
export function roadSection(mb: MeshBuilder, pts: readonly P2[], r: RoadSpec, l: StreetLook = STREET, far = false): void {
  const p = densify(pts, far ? 24 : 6), half = r.width / 2, lift = 0.3 + (9 - Math.min(9, r.cls)) * 0.02;
  mb.ribbon(p, -half, half, lift, asphaltOf(r.cls, l));
  if (r.cls > 4 || far) return;
  // lane lines: dashed 3 m every 9 m; the centre line, and lane edges on wide roads
  const lanes = Math.max(2, Math.round(r.width / 3.5)), lw = r.width / lanes, dash = 3, gap = 6;
  for (let k = 1; k < lanes; k++) {
    const off = -half + k * lw;
    let t = 0;
    for (let i = 0; i + 1 < p.length; i++) {
      const [ax, az] = p[i]!, [bx, bz] = p[i + 1]!, len = Math.hypot(bx - ax, bz - az);
      for (let s = (dash + gap) - (t % (dash + gap)); s < len; s += dash + gap) {
        const e = Math.min(len, s + dash), f0 = s / len, f1 = e / len;
        if (s < 0) continue;
        mb.ribbon([[ax + (bx - ax) * f0, az + (bz - az) * f0], [ax + (bx - ax) * f1, az + (bz - az) * f1]], off - 0.06, off + 0.06, lift + 0.02, l.marking);
      }
      t += len;
    }
  }
}
/** the bands each side of a town street: kerb, nature strip, footpath (none on freeways, highways and tracks) */
export function streetBands(r: RoadSpec, l: StreetLook = STREET): { from: number; to: number; color: string; lift: number }[] {
  if (r.cls <= 1 || r.cls >= 6) return [];
  const half = r.width / 2, strip = r.cls === 2 ? l.arterialStrip : l.strip;
  return [
    { from: half, to: half + l.kerb, color: l.kerbColor, lift: 0.2 },
    { from: half + l.kerb, to: half + l.kerb + strip, color: l.stripColor, lift: 0.12 },
    { from: half + l.kerb + strip, to: half + l.kerb + strip + l.footpath, color: l.footpathColor, lift: 0.16 },
  ];
}
/** where the front boundary of the lots is: the back of the footpath, metres from the centreline */
export function propertyLine(r: RoadSpec, l: StreetLook = STREET): number { const b = streetBands(r, l); return b.length ? b[b.length - 1]!.to : r.width / 2 + 1; }
export function sidewalks(mb: MeshBuilder, pts: readonly P2[], r: RoadSpec, l: StreetLook = STREET): void {
  const bands = streetBands(r, l); if (!bands.length) return;
  const p = densify(pts, 6);
  for (const b of bands) { mb.ribbon(p, b.from, b.to, b.lift, b.color); mb.ribbon(p, -b.to, -b.from, b.lift, b.color); }
}

// ── streets from sections and junctions (core › geometry › networks): the carriageway cut back at the junctions, each
// side's verge out to the property line (kerb with its face, nature strip, footpath), the junctions' platforms with
// their kerb returns and the verges round the corners, markings (centre dashes, crossings, give-way lines), and skirts
// where the road meets the ground. Far away: the carriageways and the platforms only.
import { cut, lengthOf, type Section } from '../../../../../../core/geometry/networks/sections.ts';
import type { Junction } from '../../../../../../core/geometry/networks/junctions.ts';
import { LEVELS } from '../../../../../../core/geometry/networks/clamp.ts';
import { offsetLine } from '../../../../../../core/geometry/networks/walkways.ts';
import { earcut } from '../../../../../../core/geometry/build/earcut.ts';

export interface StreetsLook extends StreetLook { crossing: string; giveWay: string; gapColor: string }
export const STREETS_LOOK: StreetsLook = { ...STREET, crossing: '#f2f1ea', giveWay: '#f2f1ea', gapColor: '#7aa553' };
const bandColor = (k: 'kerb' | 'strip' | 'footpath', l: StreetLook) => (k === 'kerb' ? l.kerbColor : k === 'strip' ? l.stripColor : l.footpathColor);
const bandLift = (k: 'kerb' | 'strip' | 'footpath') => (k === 'kerb' ? LEVELS.kerb : k === 'strip' ? LEVELS.strip : LEVELS.footpath);
/** a ring as a floor (triangulated) */
const floorOf = (mb: MeshBuilder, ring: readonly P2[], lift: number, color: string) => { if (ring.length >= 3) mb.floor(ring, lift, color, earcut(ring.flat(), [], 2)); };
/** a vertical face along a line: from `y0` to `y1` over each vertex's ground */
const face = (mb: MeshBuilder, line: readonly P2[], y0: number, y1: number, color: string) => { for (let i = 0; i + 1 < line.length; i++) mb.wall(line[i]![0], line[i]![1], line[i + 1]![0], line[i + 1]![1], y0, y1, color); };
/** one section: its carriageway and its verges; `far`: the carriageway alone */
export function sectionMesh(mb: MeshBuilder, s: Section, l: StreetsLook = STREETS_LOOK, far = false): void {
  const L = lengthOf(s.pts), line = densify(cut(s.pts, s.trim[0], L - s.trim[1]), 6); // (the far mesh follows the ground as closely: it is the shadow map's caster too, and a coarser road would shade the nearer one) if (line.length < 2) return;
  const p = s.profile, h = p.carriageway / 2, asphalt = asphaltOf(s.cls, l), m = p.median / 2;
  if (m > 0 && !far) {
    // a divided road: two carriageways and a raised median with its kerbs
    mb.ribbon(line, -h, -m, LEVELS.carriageway, asphalt); mb.ribbon(line, m, h, LEVELS.carriageway, asphalt);
    mb.ribbon(line, -m, -m + 0.45, LEVELS.kerb, l.kerbColor); mb.ribbon(line, m - 0.45, m, LEVELS.kerb, l.kerbColor); mb.ribbon(line, -m + 0.45, m - 0.45, LEVELS.strip, l.stripColor);
    face(mb, offsetLine(line, -m), LEVELS.carriageway - 0.05, LEVELS.kerb, l.kerbColor); face(mb, offsetLine(line, m), LEVELS.carriageway - 0.05, LEVELS.kerb, l.kerbColor);
  } else mb.ribbon(line, -h, h, LEVELS.carriageway, asphalt);
  if (far) return;
  if (s.cls <= 4 && !(m > 0)) dashes(mb, line, s.cls, p.carriageway, l);
  for (const side of ['left', 'right'] as const) {
    const v = p[side], sg = side === 'left' ? -1 : 1; let at = h;
    if (v.kerb > 0) face(mb, offsetLine(line, sg * h), LEVELS.carriageway - 0.05, LEVELS.kerb, l.kerbColor);
    for (const [kind, w] of [['kerb', v.kerb], ['strip', v.strip], ['footpath', v.footpath]] as const) {
      if (!(w > 0.05)) continue;
      const a = at * sg, b = (at + w) * sg; mb.ribbon(line, Math.min(a, b), Math.max(a, b), bandLift(kind), bandColor(kind, l)); at += w;
    }
    if (v.gap > 0.05) { const a = at * sg, b = (at + v.gap) * sg; mb.ribbon(line, Math.min(a, b), Math.max(a, b), LEVELS.strip, l.gapColor); at += v.gap; }
    // the skirt at the property line: down into the ground
    if (at > h) face(mb, offsetLine(line, sg * at), -LEVELS.skirt, LEVELS.strip, l.gapColor);
  }
}
/** the centre line dashed (AS 1742.2: 3 m lines, 9 m gaps), lane lines on wide roads; a median's two halves apart */
function dashes(mb: MeshBuilder, p: readonly P2[], cls: number, width: number, l: StreetLook): void {
  const lanes = Math.max(2, Math.round(width / 3.5)), lw = width / lanes, half = width / 2, dash = 3, gap = 9;
  for (let k = 1; k < lanes; k++) {
    const off = -half + k * lw; let t = 0;
    for (let i = 0; i + 1 < p.length; i++) {
      const [ax, az] = p[i]!, [bx, bz] = p[i + 1]!, len = Math.hypot(bx - ax, bz - az);
      for (let s = (dash + gap) - (t % (dash + gap)); s < len; s += dash + gap) { const e = Math.min(len, s + dash), f0 = s / len, f1 = e / len; mb.ribbon([[ax + (bx - ax) * f0, az + (bz - az) * f0], [ax + (bx - ax) * f1, az + (bz - az) * f1]], off - 0.06, off + 0.06, LEVELS.carriageway + LEVELS.markings, l.marking); }
      t += len;
    }
  }
  void cls;
}
/** a junction: its platform, the verges round its corners with the kerb face, its crossings and give-way lines */
export function junctionMesh(mb: MeshBuilder, j: Junction, l: StreetsLook = STREETS_LOOK, far = false): void {
  const big = Math.min(...j.arms.map((a) => a.cls));
  // the platform as a fan from the junction's middle (it is star-shaped round it: a slightly crossed outline still
  // fills cleanly, where an ear-clipper would leave spikes)
  { const ring: P2[] = [j.at, ...j.platform], n = j.platform.length, tris: number[] = []; for (let i = 0; i < n; i++) tris.push(0, 1 + i, 1 + ((i + 1) % n)); mb.floor(ring, LEVELS.platform, asphaltOf(big, l), tris); }
  if (far) return;
  for (const c of j.corners) {
    if (c.bands.length) face(mb, c.curve, LEVELS.platform - 0.05, LEVELS.kerb, l.kerbColor);
    for (const b of c.bands) { const ring = [...b.inner, ...[...b.outer].reverse()]; floorOf(mb, ring, bandLift(b.kind), bandColor(b.kind, l)); }
    const last = c.bands[c.bands.length - 1]; if (last) face(mb, last.outer, -LEVELS.skirt, bandLift(last.kind), bandColor(last.kind, l));
  }
  // zebra crossings (AS 1742.2): bars 0.6 m wide with 0.6 m gaps across the carriageway, as long as the crossing is wide
  for (const x of j.crossings) {
    const ax = x.b[0] - x.a[0], az = x.b[1] - x.a[1], w = Math.hypot(ax, az), ux = ax / w, uz = az / w, n = Math.floor(w / 1.2);
    for (let k = 0; k < n; k++) {
      const s0 = 0.3 + k * 1.2, s1 = s0 + 0.6; if (s1 > w - 0.2) break;
      const p0: P2 = [x.a[0] + ux * s0, x.a[1] + uz * s0], p1: P2 = [x.a[0] + ux * s1, x.a[1] + uz * s1];
      floorOf(mb, [p0, p1, [p1[0] + x.dir[0] * x.width, p1[1] + x.dir[1] * x.width], [p0[0] + x.dir[0] * x.width, p0[1] + x.dir[1] * x.width]], LEVELS.platform + LEVELS.markings + 0.02, l.crossing);
    }
  }
  for (const g of j.giveWay) {
    // a give-way line (AS 1742.2): 0.3 m wide, 0.6 m pieces with 0.6 m gaps
    const dx = g.b[0] - g.a[0], dz = g.b[1] - g.a[1], w = Math.hypot(dx, dz), n = Math.max(1, Math.floor(w / 1.2));
    for (let k = 0; k < n; k++) { const f0 = (k * 1.2) / w, f1 = f0 + 0.6 / w; mb.ribbon([[g.a[0] + dx * f0, g.a[1] + dz * f0], [g.a[0] + dx * f1, g.a[1] + dz * f1]], -0.15, 0.15, LEVELS.carriageway + LEVELS.markings + 0.02, l.giveWay); }
  }
}
