// core › render › graphics › live: what the graphics made in this page still hold, WebGPU and WebGL2 alike: open
// graphics (a WebGPU device or a WebGL2 context each), buffers, textures, targets, programs and their bytes. A world
// disposed leaves nothing here; a count that grows from one world to the next is a leak.
//   liveGraphics()  // { graphics: 0, buffers: 0, textures: 0, targets: 0, programs: 0, bytes: 0, made: 3 }
export interface LiveGraphics {
  /** graphics open now (each world on a canvas opens one) */
  graphics: number;
  buffers: number; textures: number;
  /** off-screen pictures and texture layers drawn into */
  targets: number;
  programs: number;
  /** bytes held on the chip by the buffers, textures and targets above */
  bytes: number;
  /** graphics opened since the page loaded */
  made: number;
}
export type LiveKind = 'buffers' | 'textures' | 'targets' | 'programs';
const live: LiveGraphics = { graphics: 0, buffers: 0, textures: 0, targets: 0, programs: 0, bytes: 0, made: 0 };
/** what the graphics made in this page still hold (a copy) */
export function liveGraphics(): LiveGraphics { return { ...live }; }
/** @internal the graphics count what they make and free */
export const tally = {
  open(): void { live.graphics++; live.made++; },
  close(): void { live.graphics--; },
  add(kind: LiveKind, bytes = 0): void { live[kind]++; live.bytes += bytes; },
  remove(kind: LiveKind, bytes = 0): void { live[kind]--; live.bytes -= bytes; },
};
/** what one graphics holds, by the label each buffer, texture and target was made with: the chip's memory as a budget
 *  sees it (a layer's things carry its id in their labels) */
export interface HeldItem { label: string; bytes: number; count: number }
/** @internal a graphics' holdings by label */
export class Held {
  private m = new Map<string, { bytes: number; count: number }>();
  add(label: string, bytes: number): void { let x = this.m.get(label); if (!x) this.m.set(label, (x = { bytes: 0, count: 0 })); x.bytes += bytes; x.count++; }
  remove(label: string, bytes: number): void { const x = this.m.get(label); if (!x) return; x.bytes -= bytes; if (--x.count <= 0) this.m.delete(label); }
  /** the largest first */
  list(): HeldItem[] { return [...this.m].map(([label, x]) => ({ label, bytes: x.bytes, count: x.count })).sort((a, b) => b.bytes - a.bytes); }
}
