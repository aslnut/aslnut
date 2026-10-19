// modules › presets › humans › poses › ops: a human skeleton posed in anatomical words. Every rotation is about an
// axis of the body's rest frame (x its left, y up, z forward), so a pose means the same on every body: flex (swing
// forward), abduct (out to the side), twist (about the bone), turn (about up), lean (sideways), armTo (an arm at so many
// degrees from hanging down), curl (fingers). Then the helper bones follow their source part way, and the correctives
// are weighed from the joints' measured angles. Pure.
//   const rig = humanRig(skeleton, joints, template); const ops = rig.begin(); ops.armTo('Left', 30); ops.flex('LeftForeArm', 45)
//   const frame = rig.end()   → { pose, morphs }  (core › entities › body › skin: a PoseFrame)
import { qpart, rotate, rotateVec, type Skeleton, type Vec3 } from '../../../../core/entities/body/skeleton.ts';
import type { PoseFrame } from '../../../../core/entities/body/skin.ts';
import type { CorrectiveRule } from '../body/template.ts';

const FWD: Vec3 = [0, 0, 1], UP: Vec3 = [0, 1, 0];
const deg = 180 / Math.PI, rad = Math.PI / 180;
const smoothstep = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a || 1e-6))); return t * t * (3 - 2 * t); };
const cross = (a: readonly number[], b: readonly number[]): Vec3 => [a[1]! * b[2]! - a[2]! * b[1]!, a[2]! * b[0]! - a[0]! * b[2]!, a[0]! * b[1]! - a[1]! * b[0]!];
const len = (a: readonly number[]) => Math.hypot(a[0]!, a[1]!, a[2]!);

/** the anatomical words (bone names without a side take one: 'LeftArm', 'RightUpLeg') */
export interface PoseOps {
  flex(bone: string, d: number): void; abduct(bone: string, d: number): void; twist(bone: string, d: number): void;
  turn(bone: string, d: number): void; twistCur(bone: string, d: number): void; lean(bone: string, d: number): void;
  armTo(side: 'Left' | 'Right', d: number): void;
  curl(side: 'Left' | 'Right', d: number, fingers?: string[], thumb?: number): void;
  both(op: (bone: string, d: number) => void, bone: string, d: number): void;
}
export class HumanRig {
  readonly sk: Skeleton;
  /** each bone's rest direction (to its tail) and side (+1 left, −1 right, 0 middle) */
  private dir0: Float32Array; private side: Int8Array;
  private helpers: { bone: number; source: number; factor: number }[];
  private rules: (CorrectiveRule & { b: number; pair: number; slot: number })[];
  private pose: Float32Array;
  /** the morph weights' layout: per side (left 0, right 1), its two correctives' keys */
  readonly morphKeys: [string[], string[]];
  constructor(sk: Skeleton, joints: Record<string, { head: readonly number[]; tail: readonly number[] }>, o: { helpers?: { bone: string; source: string; factor: number }[]; rules?: CorrectiveRule[] } = {}) {
    this.sk = sk; this.pose = sk.rest();
    this.dir0 = new Float32Array(sk.count * 3); this.side = new Int8Array(sk.count);
    sk.names.forEach((n, i) => {
      const J = joints[n]; if (!J) return;
      const d = [J.tail[0]! - J.head[0]!, J.tail[1]! - J.head[1]!, J.tail[2]! - J.head[2]!], l = len(d) || 1;
      this.dir0.set([d[0]! / l, d[1]! / l, d[2]! / l], i * 3);
      this.side[i] = J.head[0]! > 0.001 ? 1 : J.head[0]! < -0.001 ? -1 : 0;
    });
    this.helpers = (o.helpers ?? []).map((h) => ({ bone: sk.index(h.bone), source: sk.index(h.source), factor: h.factor })).filter((h) => h.bone >= 0 && h.source >= 0);
    // correctives: a side's (its key ends _L or _R), the first two of it
    const keys: [string[], string[]] = [[], []];
    this.rules = (o.rules ?? []).flatMap((r) => {
      const pair = /_R$/.test(r.key) ? 1 : 0, ks = keys[pair];
      if (!ks.includes(r.key)) { if (ks.length >= 2) return []; ks.push(r.key); }
      return [{ ...r, b: sk.index(r.bone), pair, slot: ks.indexOf(r.key) }];
    }).filter((r) => r.b >= 0);
    this.morphKeys = keys;
  }
  private B(n: string): number { return this.sk.index(n); }
  private dir(b: number): Vec3 { return [this.dir0[b * 3]!, this.dir0[b * 3 + 1]!, this.dir0[b * 3 + 2]!]; }
  private rotW(b: number, axis: readonly number[], d: number): void { if (b >= 0 && d) rotate(this.pose, b, axis, d * rad); }
  /** start a pose from rest: the anatomical words to build it with */
  begin(): PoseOps {
    this.pose = this.sk.rest();
    const r = this, B = (n: string) => r.B(n), side = (b: number) => r.side[b] ?? 0;
    const flex = (n: string, d: number) => { const b = B(n); if (b < 0) return; let ax = cross(r.dir(b), FWD); if (len(ax) < 0.2) ax = [-1, 0, 0]; r.rotW(b, ax, d); };
    const abduct = (n: string, d: number) => { const b = B(n); if (b >= 0) r.rotW(b, FWD, d * side(b)); };
    const twist = (n: string, d: number) => { const b = B(n); if (b >= 0) r.rotW(b, r.dir(b), d * (side(b) || 1)); };
    const turn = (n: string, d: number) => r.rotW(B(n), UP, d);
    const twistCur = (n: string, d: number) => { const b = B(n); if (b < 0) return; const v: Vec3 = [0, 0, 0], d0 = r.dir(b); rotateVec(v, r.pose, b * 4, d0[0], d0[1], d0[2]); r.rotW(b, v, -d * (side(b) || 1)); };
    const lean = (n: string, d: number) => r.rotW(B(n), FWD, -d);
    const fromDown = (b: number) => (b < 0 ? 0 : Math.acos(Math.max(-1, Math.min(1, -r.dir0[b * 3 + 1]!))) * deg);
    const armTo = (s: 'Left' | 'Right', d: number) => abduct(s + 'Arm', d - fromDown(B(s + 'Arm')));
    const curl = (s: 'Left' | 'Right', d: number, fingers = ['Index', 'Middle', 'Ring', 'Pinky'], thumb?: number) => {
      for (const f of fingers) for (const i of [1, 2, 3]) {
        const b = B(`${s}Hand${f}${i}`); if (b < 0) continue;
        const sd = side(b) || 1, k = Math.SQRT1_2, ax = cross(r.dir(b), [-sd * k, -k, 0]);
        if (len(ax) > 0.1) r.rotW(b, ax, d * (i === 1 ? 0.8 : 1));
      }
      if (thumb) for (const i of [1, 2, 3]) flex(`${s}HandThumb${i}`, thumb * 0.5);
    };
    const both = (fn: (n: string, d: number) => void, n: string, d: number) => { fn('Left' + n, d); fn('Right' + n, d); };
    return { flex, abduct, twist, turn, twistCur, lean, armTo, curl, both };
  }
  /** after posing: the helpers follow their source by a share, then the correctives weighed from the measured angles;
   *  the frame (the pose is the rig's: copy it to keep it) */
  end(): PoseFrame {
    for (const h of this.helpers) qpart(this.pose, h.bone * 4, this.pose, h.source * 4, h.factor);
    const m = [0, 0, 0, 0];
    for (const c of this.rules) m[c.pair * 2 + c.slot] = Math.max(m[c.pair * 2 + c.slot]!, smoothstep(c.from, c.to, this.measure(c.b, c.measure)));
    return { pose: this.pose, morphs: m };
  }
  /** a joint's angle (degrees, or a share for abduct_flex) from its rest direction, in its parent's rest frame */
  measure(b: number, kind: CorrectiveRule['measure']): number {
    const d0 = this.dir(b), q = this.pose, d: Vec3 = [0, 0, 0], sd = this.side[b] || 1;
    rotateVec(d, q, b * 4, d0[0], d0[1], d0[2]);
    const ortho = (v: Vec3): Vec3 => { const k = v[0] * d0[0] + v[1] * d0[1] + v[2] * d0[2], o: Vec3 = [v[0] - d0[0] * k, v[1] - d0[1] * k, v[2] - d0[2] * k], l = len(o) || 1; return [o[0] / l, o[1] / l, o[2] / l]; };
    const F = ortho(FWD), L = ortho([sd, 0, 0]), dt = (a: Vec3, c: Vec3) => a[0] * c[0] + a[1] * c[1] + a[2] * c[2];
    if (kind === 'flex') return Math.atan2(dt(d, F), dt(d, d0)) * deg;
    if (kind === 'abduct') return Math.asin(Math.max(-1, Math.min(1, dt(d, L)))) * deg;
    if (kind === 'twist') { const t = 2 * Math.atan2(q[b * 4]! * d0[0] + q[b * 4 + 1]! * d0[1] + q[b * 4 + 2]! * d0[2], q[b * 4 + 3]!); return t * deg * Math.sign(dt(cross(d0, F), L) || 1); }
    return Math.min(1, Math.max(0, this.measure(b, 'flex') / 90)) * Math.min(1, Math.max(0, this.measure(b, 'abduct') / 45));
  }
}
