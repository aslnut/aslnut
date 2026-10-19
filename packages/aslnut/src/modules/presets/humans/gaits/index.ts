// modules › presets › humans › gaits: how a person walks and runs, made by rotations only (no clip data), the same
// on every body: the legs swing from the hips, the knee folds as the leg comes forward, the foot rolls, the arms swing
// against the legs, the spine turns a little against the hips. A style varies it (a long stride, a brisk arm swing,
// an older person's short steps and forward lean, a child's bounce); a cycle covers the metres its stride does, so a
// baked cycle's phase follows the ground walked (core › entities: motions.auto).
//   cycle(ops, phase, 0 /* walk */, 1, GAITS.elderly)   ·   strideOf(GAITS.brisk, legLength, 0)
import type { PoseOps } from '../poses/ops.ts';

export interface GaitStyle {
  /** the legs' swing (1 as made) */
  stride?: number;
  /** the arms' swing */
  arms?: number;
  /** degrees the upper body leans forward (an older person: 6–10) */
  lean?: number;
  /** the knee's fold as the leg swings through */
  knee?: number;
  /** degrees the arms hang out from the body */
  armsOut?: number;
  /** how much the hips sway and the spine turns */
  sway?: number;
  /** the head held down (degrees) */
  head?: number;
}
export const GAITS: Readonly<Record<string, GaitStyle>> = {
  adult: {},
  brisk: { stride: 1.12, arms: 1.25, lean: 2 },
  relaxed: { stride: 0.88, arms: 0.7, sway: 1.3 },
  elderly: { stride: 0.62, arms: 0.45, lean: 9, knee: 0.7, armsOut: 3, sway: 0.6, head: 6 },
  child: { stride: 1.05, arms: 1.35, knee: 1.15, sway: 1.2 },
  teen: { stride: 1, arms: 0.8, lean: -1, sway: 1.1, head: 4 },
  stroll: { stride: 0.78, arms: 0.4, sway: 1.4, armsOut: -2 },
};

/** a walk or run at a phase (radians): run 0 … 1, amp 0 (standing) … 1 (full stride) */
export function cycle(o: PoseOps, phase: number, run = 0, amp = 1, st: GaitStyle = {}): void {
  const S = st.stride ?? 1, A = st.arms ?? 1, sw = st.sway ?? 1, s = Math.sin(phase) * amp, c = Math.cos(phase) * amp;
  const hip = (22 + 30 * run) * amp * S, knee = (50 + 45 * run) * amp * (st.knee ?? 1), arm = (18 + 30 * run) * amp * A;
  for (const [side, ph] of [['Left', 0], ['Right', Math.PI]] as const) {
    const sp = Math.sin(phase + ph), cp = Math.cos(phase + ph);
    o.armTo(side, 9 + 4 * run + (st.armsOut ?? 0));
    o.flex(side + 'UpLeg', hip * sp + (4 + 8 * run) * amp);
    // the knee folds while the leg swings forward
    o.flex(side + 'Leg', -(6 + knee * Math.max(0, cp) ** 1.4 + 10 * run * amp));
    o.flex(side + 'Foot', 12 * amp * Math.sin(phase + ph - 0.6));
    o.flex(side + 'Arm', -arm * sp);
    o.flex(side + 'ForeArm', 15 + (20 * run + 12 * Math.max(0, -sp)) * amp * A);
    o.curl(side, 15 + 45 * run, undefined, 20 * run);
  }
  o.turn('Spine', 4 * s * sw); o.turn('Spine1', -6 * s * sw); o.flex('Spine', (4 + 10 * run) * amp + (st.lean ?? 0)); o.lean('Hips', 2 * c * sw);
  if (st.head) o.flex('Head', st.head);
}
/** standing at ease, breathing (t: 0 … 1 a breath) */
export function idle(o: PoseOps, t: number, st: GaitStyle = {}): void {
  const b = Math.sin(t * Math.PI * 2);
  o.armTo('Left', 7 + b + (st.armsOut ?? 0)); o.armTo('Right', 7 + b + (st.armsOut ?? 0)); o.both(o.flex, 'ForeArm', 12 + b); o.curl('Left', 15); o.curl('Right', 15);
  o.flex('Spine1', 1.2 * b + (st.lean ?? 0) * 0.6); o.flex('Spine2', -0.8 * b);
  if (st.head) o.flex('Head', st.head);
}
/** the metres one cycle (two steps) covers: twice each step, a step the leg's swing across its length */
export function strideOf(st: GaitStyle, legLength: number, run = 0): number {
  const hip = ((22 + 30 * run) * (st.stride ?? 1) * Math.PI) / 180;
  return 4 * legLength * Math.sin(hip) * (0.92 + 0.12 * run);
}
