import type { StageGate } from './patch-policy.ts';
import { gateChecks, patchPolicy, recordPatches, type Patch, type PatchOptions, type PatchPolicy } from './patch-policy.ts';
export class BakeGateError extends Error { readonly gate:StageGate; readonly stages:StageGate[]; repairs:StageGate[]=[]; constructor(gate:StageGate, stages:StageGate[], place?:string) { super(`${place?place+': ':''}Stage ${gate.stage} (${gate.id}): ${gate.errors.join("; ")}${gate.flagged.length?'; ids '+gate.flagged.join(' '):''}`); this.gate=gate;this.stages=stages; } }
export function evaluateGate(stages: StageGate[], gate: StageGate, place?:string): void { stages.push(gate); if (!gate.ok) throw new BakeGateError(gate, stages, place); }
/** a stage's patches as it runs: one record per check, policy and algorithm (every source id, how many pieces, the
 *  worst values, a summary of what moved); the per-piece detail stays on the pieces */
export class StagePatches {
  private records = new Map<string, Patch>();
  readonly options: PatchOptions;
  constructor(options: PatchOptions = {}) { this.options = options; }
  /** the policy for a check on these ids (the default unless the options say otherwise) */
  policy(check: string, fallback: PatchPolicy, ids: readonly (string | number)[] = []): PatchPolicy { return patchPolicy(this.options, check, fallback, ids); }
  add(check: string, policy: PatchPolicy, algorithm: string, id: string | number, worst: Record<string, number> = {}, moved: Record<string, unknown> = {}): void {
    const key = `${check}|${policy}|${algorithm}`;
    let p = this.records.get(key);
    if (!p) this.records.set(key, (p = { check, policy, algorithm, ids: [], counts: { pieces: 0 }, worst: {}, moved: {} }));
    p.ids.push(id); p.counts.pieces = (p.counts.pieces ?? 0) + 1;
    for (const [k, v] of Object.entries(worst)) if (Number.isFinite(v)) p.worst[k] = Math.max(p.worst[k] ?? -Infinity, +v.toFixed(3));
    for (const [k, v] of Object.entries(moved)) if (typeof v === 'number') p.moved[k] = +(((p.moved[k] as number | undefined) ?? 0) + v).toFixed(3); else p.moved[k] = v;
  }
  list(): Patch[] { return [...this.records.values()]; }
}
/** a stage's gate closed: its patches recorded, its checks (with their policies) evaluated, pushed onto `stages`;
 *  throws BakeGateError when a check fails or an error was noted */
export function closeGate(stages: StageGate[], g: Omit<StageGate, 'ok' | 'checks' | 'patches'>, patches: Patch[], options: PatchOptions = {}, place?: string): StageGate {
  const gate: StageGate = { ...g, ok: true };
  recordPatches(gate, patches);
  gate.counts.patchedPieces = patches.filter((p) => p.policy === 'repair').reduce((a, p) => a + (p.counts.pieces ?? 0), 0);
  gate.counts.omittedPieces = patches.filter((p) => p.policy === 'omit').reduce((a, p) => a + (p.counts.pieces ?? 0), 0);
  gate.checks = gateChecks(gate, options);
  gate.ok = !gate.errors.length && gate.checks.every((c) => c.ok);
  if (!gate.ok && !gate.errors.length) gate.errors.push(`checks failed: ${gate.checks.filter((c) => !c.ok).map((c) => c.check).join(', ')}`);
  evaluateGate(stages, gate, place);
  return gate;
}
