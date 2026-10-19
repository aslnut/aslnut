// modules › world › earth › air › weather: the weather the sky sets (presets: clear, partly cloudy, overcast, drizzle, rain,
// storm, fog), eased from one to the next; what it does: clouds drifting with the wind, the sky greyed, the air
// thickening (fog, rain: the ground and everything on it fade into the haze sooner), wet ground darker and gleaming,
// lightning flashing the sky and the ground; and the rain itself: streaks falling round the eye, slanted by the wind,
// as many as it rains, hidden by what stands in front.
//   const s = sky(); earth({ sky: s }) · w.add(rain())         s.setWeather('storm')        s.setWeather({ rain: .3 })
import { Element, type AttachContext, type FrameContext, type ElementProps } from '../../../../../core/world/element.ts';
import type { DrawCall, GBuffer, Program } from '../../../../../core/render/graphics/interface.ts';
import { RAIN_GLSL } from '../../../../../core/render/graphics/shaders/rain.glsl.ts';
import { RAIN_WGSL } from '../../../../../core/render/graphics/shaders/rain.wgsl.ts';
import { D, R } from '../../../../../core/space/geo.ts';

export { WEATHERS, visibilityOf, CLEAR } from '../sky/index.ts';
export interface RainProps extends ElementProps {
  /** how hard it rains 0..1: a number, your function of the state, or (default) the world's light (the sky's weather) */
  amount?: number | ((s: FrameContext['s']) => number);
  /** streaks at the heaviest (default 6000; 2500 at quality lite) */
  count?: number;
  /** the box of rain round the eye: side and height, m (default 70, 40) */
  box?: [number, number];
  /** the streaks' colour (default from the haze) and opacity (default .55) */
  color?: [number, number, number]; opacity?: number;
  /** rain is seen near the ground only: above this camera height (m) none falls (default 3000) */
  ceiling?: number;
  /** hold the rain at this moment (s): a still picture (a capture compared across graphics); default: it falls */
  at?: number;
}
export class Rain extends Element<RainProps> {
  readonly kind = 'custom' as const;
  private prog: Program | null = null; private ubuf: GBuffer | null = null; private ibuf: GBuffer | null = null; private n = 0;
  private u = new Float32Array(12); private amountNow = 0;
  constructor(p: RainProps = {}) { super({ id: 'rain', order: 4.6, ...p }); }
  override async attach(ctx: AttachContext): Promise<void> {
    await super.attach(ctx);
    const g = ctx.graphics; if (!g) return;
    this.n = this.props.count ?? (ctx.profile?.quality === 'lite' ? 2500 : 6000);
    // each streak: its place in the box (0..1) and its speed; the same rain every time (a seeded walk)
    const d = new Float32Array(this.n * 4); let s = 12345;
    const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    for (let i = 0; i < this.n; i++) d.set([rnd(), rnd(), rnd(), 0.7 + rnd() * 0.6], i * 4);
    this.ibuf = g.buffer('instance', d, 'rain');
    this.ubuf = g.buffer('uniform', 12 * 4, 'rain block');
    this.prog = g.program({ label: 'rain', wgsl: RAIN_WGSL, glsl: RAIN_GLSL, blocks: ['Frame', 'U'], instance: { stride: 4, attributes: [{ name: 's', location: 0, size: 4, offset: 0 }] }, blend: 'alpha', depth: { write: false, test: 'less' }, cull: 'none' });
    await this.prog.ready;
  }
  override detach(): void { this.prog?.destroy(); this.ubuf?.destroy(); this.ibuf?.destroy(); this.prog = null; this.ubuf = this.ibuf = null; super.detach(); }
  frame(ctx: FrameContext): DrawCall[] {
    if (!this.prog || !this.ubuf || !this.ibuf) return [];
    const p = this.props, l = ctx.world.light ?? null, cam = ctx.camera;
    const a = typeof p.amount === 'function' ? p.amount(ctx.s) : p.amount ?? l?.rain ?? 0;
    const eyeH = cam.dist * Math.sin(cam.pitch);
    this.amountNow = cam.morph < 0.98 || eyeH > (p.ceiling ?? 3000) ? 0 : Math.max(0, Math.min(1, a));
    if (this.amountNow < 0.02) return [];
    const [side, h] = p.box ?? [70, 40], hz = l?.haze ?? [0.7, 0.75, 0.8], day = l?.daylight ?? 1, fl = l?.flash ?? 0;
    const col = p.color ?? [(hz[0] * 0.5 + 0.4) * (0.4 + 0.6 * day + fl), (hz[1] * 0.5 + 0.42) * (0.4 + 0.6 * day + fl), (hz[2] * 0.5 + 0.45) * (0.4 + 0.6 * day + fl)];
    const k = R * Math.cos(cam.lat * D), ex = cam.eye;
    // where the eye is, in metres of the ground (the streaks stay put in the world as the eye moves)
    const gx = ((k * cam.lon * D + ex[0]!) % side + side) % side, gz = ((-k * Math.log(Math.tan(Math.PI / 4 + (cam.lat * D) / 2)) + ex[2]!) % side + side) % side;
    this.u.set([side, h, this.amountNow, l?.wind ?? 8], 0);
    this.u.set([col[0], col[1], col[2], p.opacity ?? 0.55], 4);
    this.u.set([gx, gz, p.at ?? ctx.now / 1000, 0], 8);
    this.ubuf.write(this.u);
    return [{ program: this.prog, blocks: [ctx.frame, this.ubuf], instances: this.ibuf, count: 6, instanceCount: Math.max(1, Math.floor(this.n * this.amountNow)) }];
  }
  /** rain falls by itself: the frames keep coming while it does */
  override animating(): boolean { return this.amountNow >= 0.02 && this.props.at === undefined; }
}
/** rain round the eye, as hard as the sky's weather says (or your amount) */
export const rain = (p: RainProps = {}) => new Rain(p);
