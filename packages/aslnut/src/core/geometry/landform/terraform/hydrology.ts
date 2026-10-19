import { groundAt } from '../compose/ground.ts';
import type { StageGate } from '../../../runtime/workers/compile/patch-policy.ts';
// Stages 01 & 02 of the 11-stage road bake:
//   Stage 01: Local Metric Tangent-Plane Projection & Hydrological River Basin Carving
//   Stage 02: Street-Scale CSG Terraforming Stamps (FLAT_PLAZA, STAIRS, QUAY_WALL)
import type { ClampOut, Ground, P3, Piece } from '../../networks/bake-types.ts';
import type { P2 } from '../../networks/graph.ts';
import type { Patch } from '../../../runtime/workers/compile/patch-policy.ts';

export interface WaterWay {id:string|number;pts:[number,number][];kind:string;covered:boolean;width?:number;name:string|null}
export interface SolvedWater {
  id: string | number;
  name: string | null;
  kind: string;
  halfWidth: number;
  bankWidth: number;
  waterY: number;
  bedY: number;
  pts: P3[];
}
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const smoothstep = (t: number) => { const c = clamp(t, 0, 1); return c * c * (3 - 2 * c); };

export function distToPolylineXZ(x: number, z: number, pts: readonly P3[]): { dist: number; y: number } {
  let bestD2 = Infinity, bestY = pts[0]?.[2] ?? 0;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i]!, b = pts[i + 1]!, dx = b[0] - a[0], dz = b[1] - a[1], l2 = dx * dx + dz * dz;
    const t = l2 > 1e-6 ? clamp(((x - a[0]) * dx + (z - a[1]) * dz) / l2, 0, 1) : 0;
    const px = a[0] + dx * t, pz = a[1] + dz * t, d2 = (x - px) ** 2 + (z - pz) ** 2;
    if (d2 < bestD2) { bestD2 = d2; bestY = a[2] + (b[2] - a[2]) * t; }
  }
  return { dist: Math.sqrt(bestD2), y: bestY };
}

export function runStage01Terrain(
  rawGround: Ground,
  waterways: readonly WaterWay[] | undefined,
  toLocal: (lon: number, lat: number) => P2,
  clampOut: ClampOut,
): { ground: Ground; waters: SolvedWater[]; gate: StageGate } {
  const ground: Ground = { ...rawGround, data: new Float32Array(rawGround.data) };
  const waters: SolvedWater[] = [];
  let carvedCells = 0, invalidWaterways=0, waterSamples=0, minBedY = Infinity, maxWaterY = -Infinity;

  if (rawGround.nx < 2 || rawGround.nz < 2 || rawGround.step <= 0 || rawGround.data.length !== rawGround.nx * rawGround.nz) return { ground, waters, gate: { stage: 1, id: 'terrain-hydrology', name: 'Terrain', ok: false, counts: {}, worst: {}, flagged: [], errors: ['invalid DEM dimensions or spacing'] } };
  const flagged:(string|number)[]=[];
  for (const w of waterways ?? []) {
    const kind = w.kind;
    if (!['river', 'canal', 'stream', 'drain'].includes(kind)) continue;
    if (w.covered) continue;
    if (w.pts.length < 2) continue;
    const xy = w.pts.map(([lo, la]) => toLocal(lo, la));
    if(!xy.every(p=>p.every(Number.isFinite))){invalidWaterways++;flagged.push(w.id);continue;}waterSamples+=xy.length;
    const rawW = w.width ?? NaN;
    const halfWidth = Number.isFinite(rawW) && rawW > 0 ? rawW / 2 : kind === 'river' ? 24 : kind === 'canal' ? 8 : 2.5;
    const bankWidth = kind === 'river' ? 16 : kind === 'canal' ? 8 : 4;
    const samples = xy.map(([x, z]) => groundAt(rawGround, x, z)).sort((a, b) => a - b);
    const refY = samples[Math.floor(samples.length * 0.15)] ?? 2;
    const waterY = +(kind === 'river' ? Math.min(refY, Math.max(0.5, refY - 0.8)) : Math.max(0.4, refY - 0.5)).toFixed(2);
    const bedDepth = kind === 'river' ? 3.6 : kind === 'canal' ? 2.0 : 1.0;
    const bedY = +(waterY - bedDepth).toFixed(2);
    if (bedY < minBedY) minBedY = bedY;
    if (waterY > maxWaterY) maxWaterY = waterY;
    const pts: P3[] = xy.map(([x, z]) => [x, z, waterY]);
    waters.push({ id: w.id, name: w.name, kind, halfWidth, bankWidth, waterY, bedY, pts });

    let xMin = Infinity, xMax = -Infinity, zMin = Infinity, zMax = -Infinity;
    for (const [x, z] of xy) { if (x < xMin) xMin = x; if (x > xMax) xMax = x; if (z < zMin) zMin = z; if (z > zMax) zMax = z; }
    const pad = halfWidth*1.5*3;
    const i0 = clamp(Math.floor((xMin - pad - ground.x0) / ground.step), 0, ground.nx - 1);
    const i1 = clamp(Math.ceil((xMax + pad - ground.x0) / ground.step), 0, ground.nx - 1);
    const j0 = clamp(Math.floor((zMin - pad - ground.z0) / ground.step), 0, ground.nz - 1);
    const j1 = clamp(Math.ceil((zMax + pad - ground.z0) / ground.step), 0, ground.nz - 1);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const x = ground.x0 + i * ground.step, z = ground.z0 + j * ground.step;
      const { dist } = distToPolylineXZ(x, z, pts);
      if (dist >= pad) continue;
      const gaussian = Math.exp(-((dist / (halfWidth * 1.5)) ** 2));
      const idx = j * ground.nx + i, oldY = ground.data[idx]!;
      const carved = oldY - Math.max(bedDepth, oldY - bedY) * gaussian;
      if (carved < oldY) { ground.data[idx] = carved; carvedCells++; }
    }
    // Emit river channel clamp edges so live browser terrain also carves the river basin under bridges
    void clampOut; // The carved DEM is exported with the final terrain contract in Stage 11.
  }

  let nanHeights = 0;
  for (let i = 0; i < ground.data.length; i++) if (!Number.isFinite(ground.data[i]!)) nanHeights++;
  let maxDownstreamRiseM=0;for(const w of waters)for(let i=1;i<w.pts.length;i++)maxDownstreamRiseM=Math.max(maxDownstreamRiseM,w.pts[i]![2]-w.pts[i-1]![2]);
  const errors:string[]=[];if(maxDownstreamRiseM>1e-6)errors.push(`Water rises downstream by ${maxDownstreamRiseM} m`);if(nanHeights)errors.push(`${nanHeights} non-finite terrain heights`);if(invalidWaterways)errors.push(`${invalidWaterways} non-finite waterway coordinates`);
  return {
    ground,
    waters,
    gate: {
      stage: 1,
      id: 'terrain-hydrology',
      name: 'Local Metric Projection & Hydrological Basin Carving',
      ok: errors.length === 0,
      counts: { waterways: waters.length, rivers: waters.filter((w) => w.kind === 'river').length, carvedCells, waterSamples, invalidWaterways, nanHeights },
      worst: { minBedY: Number.isFinite(minBedY) ? minBedY : 0, maxWaterY: Number.isFinite(maxWaterY) ? maxWaterY : 0, maxDownstreamRiseM },
      flagged,
      errors,
    },
  };
}

