// core › render › graphics › shaders: the shader language people write (a WGSL subset → GLSL ES 3.0), hooks and custom layers
export { translateStatements, translateModule, parseType, typeName, glslType, uniformLayout, ShaderError } from './translate.ts';
export type { Type, Scalar, ScopeSpec, Translated } from './translate.ts';
export { HOOK_POINTS, CUSTOM_SCOPE, assemble, assembleCustom, paramBlock, paramType } from './hooks.ts';
export type { HookName, HookPoint, ShaderCode, ParamValue, ParamBlock, CustomCode, Sources } from './hooks.ts';
