import { groundAt } from '../compose/ground.ts';
import type { StageGate } from '../../../runtime/workers/compile/patch-policy.ts';
// Stages 01 & 02 of the 11-stage road bake:
//   Stage 01: Local Metric Tangent-Plane Projection & Hydrological River Basin Carving
//   Stage 02: Street-Scale CSG Terraforming Stamps (FLAT_PLAZA, STAIRS, QUAY_WALL)
import type { ClampOut, Ground, P3, Piece } from '../../networks/bake-types.ts';
import type { P2 } from '../../networks/graph.ts';
import type { Patch } from '../../../runtime/workers/compile/patch-policy.ts';

import type { SolvedWater } from './hydrology.ts';
export interface StampSpec {
  id?: string | number;
  type: 'FLAT_PLAZA' | 'STAIRS' | 'QUAY_WALL';
  cx: number;
  cz: number;
  angle: number;
  halfL: number;
  halfW: number;
  feather?: number;
  y0?: number;
  yBot?: number;
  yTop?: number;
  yLow?: number;
  yHigh?: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const smoothstep = (t: number) => { const c = clamp(t, 0, 1); return c * c * (3 - 2 * c); };

export function runStage02Stamps(
  ground: Ground,
  stampsIn: readonly StampSpec[] | undefined,
  pathsIn: readonly unknown[] | undefined,
  _waters: readonly SolvedWater[],
  toLocal: (lon: number, lat: number) => P2,
  pieces: Piece[],
  info: (kind: string, props: Record<string, unknown>) => number,
  groundContract?: ClampOut,
): { gate: StageGate } {
  const specs: StampSpec[] = [...(stampsIn ?? [])];

  let modifiedCells = 0, maxStepGrade = 0, maxRiserM=0, invalidStamps = 0, stairs = 0, quays = 0, plazas = 0;
  const stepInfo = specs.some((s) => s.type === 'STAIRS') ? info('steps', { what: 'outdoor steps', source: 'Stage 02 CSG terraforming stamp' }) : 0;
  const quayInfo = specs.some((s) => s.type === 'QUAY_WALL') ? info('quay', { what: 'quay wall', source: 'Stage 02 CSG terraforming stamp' }) : 0;

  for (const s of specs) {
    if (!['FLAT_PLAZA','STAIRS','QUAY_WALL'].includes(s.type) || !(s.halfL > 0 && s.halfW > 0) || ![s.cx,s.cz,s.angle,s.halfL,s.halfW,...[s.y0,s.yBot,s.yTop,s.yLow,s.yHigh].filter((x):x is number=>x!==undefined)].every(Number.isFinite)) { invalidStamps++; continue; }
    const F = Math.max(.01,s.feather ?? 4), cos = Math.cos(s.angle), sin = Math.sin(s.angle);
    const yBot = s.yBot ?? s.yLow ?? s.y0 ?? groundAt(ground, s.cx, s.cz);
    const yTop = s.yTop ?? s.yHigh ?? s.y0 ?? yBot;
    const R = Math.hypot(s.halfL + F, s.halfW + F);
    const i0 = clamp(Math.floor((s.cx - R - ground.x0) / ground.step), 0, ground.nx - 1);
    const i1 = clamp(Math.ceil((s.cx + R - ground.x0) / ground.step), 0, ground.nx - 1);
    const j0 = clamp(Math.floor((s.cz - R - ground.z0) / ground.step), 0, ground.nz - 1);
    const j1 = clamp(Math.ceil((s.cz + R - ground.z0) / ground.step), 0, ground.nz - 1);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const x = ground.x0 + i * ground.step - s.cx, z = ground.z0 + j * ground.step - s.cz;
      const u = x * cos + z * sin, v = -x * sin + z * cos;
      const db = Math.max(Math.max(Math.abs(u) - s.halfL, 0) / F, Math.max(Math.abs(v) - s.halfW, 0) / F);
      if (db >= 1) continue;
      const w = 1 - smoothstep(db);
      const steps = Math.max(1, Math.ceil(Math.abs(yTop-yBot)/0.18));
      const target = s.type === 'FLAT_PLAZA' ? (s.y0 ?? yBot) : s.type === 'STAIRS' ? yTop + (yBot - yTop) * Math.floor(clamp((v + s.halfW) / (2 * s.halfW), 0, 1)*steps)/steps : v < 0 ? yBot : yTop;
      const idx = j * ground.nx + i;
      ground.data[idx] = ground.data[idx]! * (1 - w) + target * w;
      modifiedCells++;
    }
    if (s.type === 'STAIRS') {
      stairs++;
      const dh = yTop-yBot;
      if(!(dh>0)){invalidStamps++;continue;}
      const grade=dh/(2*s.halfW);maxStepGrade=Math.max(maxStepGrade,grade);
      const nSteps=Math.max(1,Math.ceil(dh/.18)),tread=2*s.halfW/nSteps;maxRiserM=Math.max(maxRiserM,dh/nSteps);
      const id=s.id!==undefined?info('steps',{osm:s.id,source:'Fitted CSG stamp'}):stepInfo;
      for(let k=0;k<nSteps;k++){
        const v=-s.halfW+tread*(k+.5),top=yTop-dh*k/nSteps+.02,bottom=yTop-dh*(k+1)/nSteps-.35;
        pieces.push({t:'box',kind:'ramp',at:[s.cx-v*sin,s.cz+v*cos,bottom],top,w:tread,d:2*s.halfL,turn:s.angle,info:id});
        if(groundContract){const ring:P3[]=[];for(const [u,w]of [[-s.halfL,v-tread/2],[s.halfL,v-tread/2],[s.halfL,v+tread/2],[-s.halfL,v+tread/2]])ring.push([s.cx+u!*cos-w!*sin,s.cz+u!*sin+w!*cos,top-.02]);groundContract.cells.push([ring]);}
      }
      for(const side of [-1,1]){
        const line:[number,number,number,number][]=[];
        for(let k=0;k<=nSteps;k++){const v=-s.halfW+tread*k,h=yTop-dh*k/nSteps;line.push([s.cx+side*s.halfL*cos-v*sin,s.cz+side*s.halfL*sin+v*cos,h+1,h+.95]);}
        pieces.push({t:'wall',kind:'retaining',line,info:id});
      }
    } else if (s.type === 'QUAY_WALL') {
      quays++;
      pieces.push({
        t: 'wall', kind: 'retaining', info: quayInfo,
        line: [[s.cx - s.halfL * cos, s.cz - s.halfL * sin, yTop, yBot], [s.cx + s.halfL * cos, s.cz + s.halfL * sin, yTop, yBot]],
      });
    } else plazas++;
  }
  for(const h of ground.data)if(!Number.isFinite(h)){invalidStamps++;break;}
  const errors = invalidStamps > 0 ? [`Stage 02: ${invalidStamps} invalid stamp specs`] : [];
  return {
    gate: {
      stage: 2,
      id: 'terraforming-stamps',
      name: 'Street-Scale CSG Terraforming Stamps',
      ok: errors.length === 0,
      counts: { stamps: specs.length - invalidStamps, stairs, quays, plazas, modifiedCells, invalidStamps },
      worst: { maxStepGrade: +maxStepGrade.toFixed(3), maxRiserM },
      flagged: [],
      errors,
    },
  };
}
