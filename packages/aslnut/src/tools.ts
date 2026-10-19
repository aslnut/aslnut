/** Build-time entry points, kept out of the visitor's world bundle. */
export { compile, type RoadCompileOptions } from './modules/world/earth/presets/built/roads/compile.ts';
export { BakeGateError } from './core/runtime/workers/compile/gates.ts';
export type { PatchPolicy, PatchRule, PatchOptions } from './core/runtime/workers/compile/patch-policy.ts';
