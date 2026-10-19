// core › render › graphics › interface: how aslnut talks to the graphics chip. One interface, two first-class
// implementations: WebGPU (webgpu.ts) and WebGL2 (webgl2.ts). Layers never touch either API: they make buffers,
// textures and programs here and hand the renderer draw calls. A program carries a WGSL text and its GLSL twin with
// the same structure:
//   uniform blocks   WGSL @group(0) @binding(i) var<uniform> name: T   ·  GLSL layout(std140) uniform T { … } name;
//   textures         WGSL @group(1) @binding(i), then one sampler      ·  GLSL uniform sampler… <name>;
//   instance data    WGSL @location(i) in the vertex input              ·  GLSL layout(location = i) in …;
// Clip space: both shaders write WebGPU's depth range (0..w); the GLSL side ends with clipOut() to map it to GL's.

export type Api = 'webgpu' | 'webgl2';
export interface Caps {
  api: Api;
  /** compute shaders (WebGPU only: WebGL2 runs the CPU path of anything that would use them) */
  compute: boolean;
  /** GPU timing queries */
  timer: boolean;
  /** float render targets */
  floatTargets: boolean;
  /** the largest 2D texture side, and array layers */
  maxTex: number; maxLayers: number;
  /** textures readable in the vertex stage */
  vertexTextures: number;
  f16: boolean;
  /** the chip, as the browser names it (may be empty) */
  device: string;
}
export type TexFormat = 'rgba8' | 'rgba32f' | 'r32f';
export interface TextureDesc { label?: string; width: number; height: number; /** set: a 2D array texture */ layers?: number; format: TexFormat; filter?: 'linear' | 'nearest'; /** drawn into (layerTarget) and read back (readTexture): a field's state. rgba8 always is; a float one needs caps.floatTargets */ renderable?: boolean; /** its layers can be copied into a bigger one (copyLayers: a pool grown by need) */ growable?: boolean }
export interface GTexture {
  readonly desc: TextureDesc;
  /** write a rectangle of one layer: rgba8 → Uint8Array, float formats → Float32Array; rows tightly packed */
  write(data: ArrayBufferView, o?: { x?: number; y?: number; layer?: number; width?: number; height?: number }): void;
  /** an image (decoded off the main thread: an ImageBitmap, or a canvas) into a rectangle of one layer (rgba8 only):
   *  no pixels pass through JavaScript */
  writeImage(src: ImageBitmap | OffscreenCanvas | HTMLCanvasElement, o?: { x?: number; y?: number; layer?: number; /** the texture holds colours times alpha (a picture
   *  with see-through parts, filtered without fringes: the same on WebGPU and WebGL2); give it a bitmap made with
   *  premultiplyAlpha: 'premultiply' */ premultiplied?: boolean }): void;
  destroy(): void;
}
export type BufferKind = 'uniform' | 'index' | 'instance' | 'vertex';
export interface GBuffer { readonly kind: BufferKind; readonly size: number; write(data: ArrayBufferView, offsetBytes?: number): void; destroy(): void; /** a number for this buffer, and how many times it was written (what a cached picture was drawn from) */ readonly uid: number; readonly version: number }
export interface Attribute { name: string; location: number; size: 1 | 2 | 3 | 4; /** in floats, within the instance */ offset: number }
export interface ProgramDesc {
  label: string;
  wgsl: string;
  glsl: { vertex: string; fragment: string };
  /** uniform blocks in binding order: the GLSL block (type) names; WGSL bindings 0..n-1 of group 0 */
  blocks: string[];
  /** textures in binding order (WGSL group 1, bindings 0..n-1, then the sampler at n); the GLSL sampler names */
  textures?: { name: string; kind: '2d' | '2d-array'; sample: 'float' | 'unfilterable' }[];
  /** per-instance data: one interleaved float32 buffer */
  instance?: { stride: number; attributes: Attribute[] };
  /** per-vertex data: one interleaved float32 buffer (locations apart from the instance's) */
  vertex?: { stride: number; attributes: Attribute[] };
  blend?: 'none' | 'alpha' | 'add' | 'premultiplied' | 'multiply' | 'screen';
  depth?: { write: boolean; test: 'less' | 'less-equal' | 'greater-equal' | 'always' };
  cull?: 'none' | 'back' | 'front';
  /** what the vertices make: triangles (default), or lines (pairs of vertices, a pixel wide: wireframes, nets) */
  topology?: 'triangles' | 'lines';
  /** reads the depth of everything drawn before it in the frame (draped ground marks, labels hidden by hills):
   *  WGSL `@group(2) @binding(0) var sceneDepth: texture_depth_2d;` · GLSL `uniform highp sampler2D sceneDepth;`.
   *  Its draws never write depth */
  sceneDepth?: boolean;
  /** with sceneDepth: also reads the depth of the terrain alone, as it was kept before the twin's solids were drawn (a
   *  draw marked `keepDepth`): WGSL `@group(2) @binding(1) var groundDepth: texture_2d<f32>;` · GLSL
   *  `uniform highp sampler2D groundDepth;` (core › geometry › marks › drape: a mark's part over the twin's solids) */
  groundDepth?: boolean;
  /** draws into a layer of an rgba8 texture (a tile's ground marks, see layerTarget): no depth, the texture's format */
  overlay?: boolean;
  /** with overlay: the format of the texture drawn into (default rgba8; a float one: a field's step, never blended) */
  format?: TexFormat;
}
export interface Program {
  readonly label: string; readonly desc: ProgramDesc;
  /** resolves when built; rejects with AslnutError E-GPU-003 and the compiler's log (a failed program draws nothing) */
  readonly ready: Promise<void>;
  destroy(): void;
}
export interface DrawCall {
  program: Program;
  /** buffers for the program's uniform blocks, in order */
  blocks: GBuffer[];
  textures?: GTexture[];
  instances?: GBuffer;
  vertices?: GBuffer;
  index?: GBuffer;
  /** vertices (or indices) per instance */
  count: number;
  instanceCount?: number;
  /** the program that draws it in the picking pass (ids, no blending); none: not in that pass */
  pickProgram?: () => Program;
  /** a mark lying on the ground: where the ground can take it (the surface's per-tile overlays), drawn into each tile
   *  under it instead of into the frame (this call stays for picking) */
  ground?: GroundDraw;
  /** the first vertex (non-indexed draws): vertex numbers start there */
  first?: number;
  /** it casts a shadow: drawn into the sun's shadow map with its picking twin (frame.pick.y = 1: depth, packed) */
  cast?: boolean;
  /** its box in world metres [min x, y, z, max x, y, z]: the shadow pass leaves out what is outside the sun's box */
  bounds?: readonly number[];
  /** out of the camera's view: only a caster (drawn into the shadow map, not into the frame, not picked) */
  shadowOnly?: boolean;
  /** a draped mark's part over the twin's solids (core › geometry › marks › drape): the world draws it after the
   *  things standing on the ground, in its layer's order among the other such parts; 'ground': a mark on the ground's,
   *  drawn after what lies on the ground (roads, paths) and before what stands on it (it never paints a bench) */
  upper?: boolean | 'ground';
  /** what stands on the ground (buildings, trees, benches, a set's things): never painted by a mark on the ground (drawn
   *  after its parts over the solids) */
  stands?: boolean;
  /** before this draw the depth drawn so far (the terrain alone) is kept for programs that read `groundDepth` (the
   *  world marks the first draw after the ground, in frames with upper parts) */
  keepDepth?: boolean;
}
/** a ground mark's part in the tiles' overlays: its look's version (changed: every tile is drawn again) and its draws
 *  for one tile (bounds relative to the view's centre as the layer blocks are: west lon rad, width rad, north Mercator
 *  y, height; box in degrees for picking the pieces) */
export interface GroundDraw {
  version: string;
  /** the look changed from `version` only within these boxes (w, s, e, n degrees each, flat): tiles drawn at that
   *  version elsewhere stay as they are (a hovered feature redraws the tiles under it, not every tile) */
  since?: { version: string; boxes: ArrayLike<number> };
  /** its programs are built (a tile drawn before would come out empty and be kept) */
  ready: boolean;
  /** where its marks are [w, s, e, n] (degrees): tiles elsewhere need no overlay for it (none: anywhere) */
  where?: readonly [number, number, number, number] | null;
  tile(t: { key: number; bounds: [number, number, number, number]; box: [number, number, number, number]; block: GBuffer }, out: DrawCall[]): void;
}
/** a picture drawn off screen (picking draws ids into a small one, the sun its shadow map): colour + depth; made
 *  `sampled`, its colour is a texture later draws read (`texture`: the canvas's colour format, 8 bits a channel) */
export interface GTarget { readonly width: number; readonly height: number; readonly texture?: GTexture; destroy(): void }
export interface FrameOptions {
  clear: [number, number, number, number];
  /** read the frame back (RGBA, top row first) */
  read?: boolean;
  /** draw into this instead of the canvas (nothing is presented) */
  target?: GTarget;
  /** only this part of the picture (device px from the top left: x, y, width, height); what is outside stays */
  scissor?: [number, number, number, number];
  /** keep what this frame's picture holds already (a second part drawn beside the first): the colour is not cleared
   *  (inside a scissor the clear colour still fills it on WebGL2; WebGPU's draws cover it) */
  keep?: boolean;
  /** its depth kept for a later pass (stored), and with `keep` the depth drawn before it loaded too: a picture drawn in
   *  several passes, each tested against the ones before (every card set's claims on one picture) */
  keepDepth?: boolean;
  /** smooth the picture's edges (FXAA: drawn off screen, then onto the canvas through the filter); the canvas frame
   *  only, drawn whole (not with `keep` or a `scissor`) */
  aa?: boolean;
}

export interface Graphics {
  /** submit queued off-screen preparation without drawing another visible frame */
  flush?(): void;
  /** a frame being made (from its first draw gathered until it is drawn): what is destroyed meanwhile is freed once it
   *  is drawn (a buffer your everyFrame work replaced is still the frame's); hold(false) frees it */
  hold?(on: boolean): void;
  readonly api: Api;
  readonly caps: Caps;
  /** the drawing buffer in device pixels */
  readonly width: number; readonly height: number;
  resize(width: number, height: number): void;
  buffer(kind: BufferKind, sizeOrData: number | ArrayBufferView, label?: string): GBuffer;
  texture(desc: TextureDesc): GTexture;
  /** an off-screen picture to draw into (picking; sampled: its colour is a texture draws can read: the shadow map) */
  target(width: number, height: number, o?: { sampled?: boolean; /** what it is (graphics memory by label) */ label?: string }): GTarget;
  /** a layer of an rgba8 array texture to draw into (colour only, no depth): programs made with `overlay: true` */
  layerTarget(texture: GTexture, layer: number): GTarget;
  /** the first `layers` layers of `from` into `to` (the same size and format; `from` made growable): a pool grown
   *  without drawing or loading again. False: nothing in `to` to rely on, `from` as it was: not here (a float texture
   *  where WebGL2 cannot draw into floats), or the copy did not land (WebGL2 refused it under a busy GPU process) */
  copyLayers(from: GTexture, to: GTexture, layers: number): boolean;
  /** a texture's texels back (layer 0 of a 2D one, row 0 first, as written): float formats → Float32Array (r32f: one
   *  number a texel, rgba32f: four), rgba8 → Uint8Array. Waits for the chip without stalling it. Only a texture made
   *  `renderable` (or `growable`): any other is refused (E-GPU-003) on both graphics (WebGPU cannot copy it out) */
  readTexture(texture: GTexture): Promise<Float32Array | Uint8Array>;
  /** compile and link (throws AslnutError E-GPU-003 with the compiler's log) */
  program(desc: ProgramDesc): Program;
  /** one pass: clear, the draws in order, present; with `read`, the pixels come back */
  frame(draws: DrawCall[], o: FrameOptions): Promise<Uint8Array> | null;
  /** what the last frame cost: draw calls, passes, bytes uploaded since the frame before */
  readonly stats: { draws: number; passes: number; uploadBytes: number; /** textures and buffers written in the last frame */ uploads: number; /** the chip's time for a recent frame (ms), where the graphics can measure it (WebGL2: EXT_disjoint_timer_query_webgl2); null: not measured */ gpuMs: number | null; /** the longest single texture write of the last frame (ms on the main thread) */ uploadMaxMs: number };
  /** resolves with a reason when the device is lost */
  readonly lost: Promise<string>;
  /** bytes held on the chip by buffers and textures made here (what dispose frees) */
  readonly bytes: number;
  /** what is held, by the label each was made with (the largest first): where the chip's memory goes */
  memory(): import('./live.ts').HeldItem[];
  destroy(): void;
}

/** the frame block every program shares: viewProj + 7 vec4 + its inverse + 1 vec4, the light's matrix + 5 vec4, the
 *  theme's 3 vec4 = 112 floats (see shaders/frame.wgsl.ts) */
export const FRAME_FLOATS = 112;
