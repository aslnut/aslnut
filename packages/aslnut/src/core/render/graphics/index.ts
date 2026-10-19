// core › render › graphics: one interface, two first-class implementations
export type { Api, Caps, Graphics, GBuffer, GTexture, Program, ProgramDesc, DrawCall, TextureDesc, TexFormat, Attribute, BufferKind, FrameOptions } from './interface.ts';
export { FRAME_FLOATS } from './interface.ts';
export { createWebGPU } from './webgpu.ts';
export { createWebGL2 } from './webgl2.ts';
