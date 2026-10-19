// modules › world › sky: one full-screen pass behind the surface: space, stars and the glow round the globe; a sky
// from the horizon colour to the zenith over the flat map.
import { mat4 } from 'wgpu-matrix';
import { Element, type AttachContext, type FrameContext, type ElementProps } from '../../../core/world/element.ts';
import type { DrawCall, GBuffer, Program } from '../../../core/render/graphics/interface.ts';
import { SKY_GLSL } from '../../../core/render/graphics/shaders/sky.glsl.ts';
import { SKY_WGSL } from '../../../core/render/graphics/shaders/sky.wgsl.ts';
import { R } from '../../../core/space/geo.ts';

export interface SkyProps extends ElementProps { space?: [number, number, number]; glow?: [number, number, number]; horizon?: [number, number, number]; zenith?: [number, number, number]; stars?: number }

export class Sky extends Element<SkyProps> {
  readonly kind = 'sky' as const;
  private prog: Program | null = null; private ubuf: GBuffer | null = null; private u = new Float32Array(36);
  constructor(p: SkyProps = {}) { super({ id: 'sky', ...p }); }
  override async attach(ctx: AttachContext): Promise<void> {
    await super.attach(ctx);
    const g = ctx.graphics; if (!g) return;
    this.ubuf = g.buffer('uniform', 36 * 4, 'sky');
    this.prog = g.program({ label: 'sky', wgsl: SKY_WGSL, glsl: SKY_GLSL, blocks: ['Frame', 'U'], depth: { write: false, test: 'always' } });
    await this.prog.ready;
  }
  frame(ctx: FrameContext): DrawCall[] {
    if (!this.prog || !this.ubuf) return [];
    const p = this.props, u = this.u;
    u.set(mat4.inverse(ctx.camera.viewProj), 0);
    u.set([...(p.space ?? [0.015, 0.02, 0.04]), 1], 16);
    u.set([...(p.glow ?? [0.55, 0.75, 1.0]), 1], 20);
    u.set([...(p.horizon ?? [0.82, 0.88, 0.94]), 1], 24);
    u.set([...(p.zenith ?? [0.45, 0.62, 0.86]), 1], 28);
    u.set([ctx.camera.morph, R, p.stars ?? 1, 0], 32);
    this.ubuf.write(u);
    return [{ program: this.prog, blocks: [ctx.frame, this.ubuf], count: 3 }];
  }
  override detach(): void { this.prog?.destroy(); this.ubuf?.destroy(); this.prog = null; this.ubuf = null; super.detach(); }
}
