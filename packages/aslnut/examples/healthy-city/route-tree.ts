// The ways to the parks as one tree: every stretch of every house's walk drawn once, each stretch a small record (its
// two ends, the ground under them, the walk left from each), all of them instances of one quad; their colour comes
// from the walk left (a scale that moves with a uniform: nothing written again when the loaded range changes), their
// dashes run along it towards the park. New houses append their stretches (only those written); a change of the
// ground reads two heights a stretch again, a slice a frame. A layer of this page's own (core › world › layer).
import { Element, motionFrames, rgba, type AttachContext, type DrawCall, type FrameContext, type GBuffer, type ElementProps, type ElementStatus, type Program, type State } from '../../src/index.ts';
import { Origin } from '../../src/core/geometry/build/mesh.ts';
import { FRAME_GLSL } from '../../src/core/render/graphics/shaders/frame.glsl.ts';
import { FRAME_WGSL } from '../../src/core/render/graphics/shaders/frame.wgsl.ts';

const ROUTE_WGSL = /* wgsl */ `${FRAME_WGSL}
// origin (the origin's offset from the view centre: lon rad, Mercator y; exaggeration; lift m) · look (opacity, the
// scale's low and high walk m, width CSS px) · c0, c1, c2 (the ramp: near, middle, far) · dash (on px, off px, px a
// second towards the park, 0)
struct U { origin: vec4f, look: vec4f, c0: vec4f, c1: vec4f, c2: vec4f, dash: vec4f }
@group(0) @binding(1) var<uniform> u: U;
struct I { @location(0) ab: vec4f, @location(1) hc: vec4f, @builtin(vertex_index) vid: u32 }
struct O { @builtin(position) pos: vec4f, @location(0) across: f32, @location(1) halfw: f32, @location(2) cost: f32, @location(3) mpp: f32 }
const PI = 3.141592653589793;
const RE = 6378137.0;
fn s2(a: f32) -> f32 {
  let s = sin(a * 0.5);
  return 2.0 * s * s;
}
fn placeAt(rel: vec2f, h: f32) -> vec3f {
  let dl = u.origin.x + rel.x;
  let dm = u.origin.y + rel.y;
  let c = RE * frame.misc.y;
  let F = vec3f(c * dl, h, -c * dm);
  if (frame.size.w >= 1.0) {
    return F;
  }
  let lat = 2.0 * atan(exp(frame.geo.x + dm)) - PI * 0.5;
  let dp = lat - frame.misc.x;
  let rr = RE + h;
  let cl = cos(lat);
  let k = s2(dp) + frame.misc.y * cl * s2(dl);
  let G = vec3f(rr * cl * sin(dl), h - rr * k, -rr * (sin(dp) + frame.geo.y * cl * s2(dl)));
  return mix(G, F, frame.size.w);
}
fn screenOf(c: vec4f) -> vec2f {
  return c.xy / c.w * frame.size.xy * 0.5;
}
@vertex fn vs(i: I) -> O {
  let end = f32(i.vid / 2u);
  let side = select(-1.0, 1.0, (i.vid & 1u) == 1u);
  let PA = placeAt(i.ab.xy, i.hc.x * u.origin.z + u.origin.w);
  let PB = placeAt(i.ab.zw, i.hc.y * u.origin.z + u.origin.w);
  let cA = frame.viewProj * vec4f(PA, 1.0);
  let cB = frame.viewProj * vec4f(PB, 1.0);
  var o: O;
  if (cA.w <= 0.0 || cB.w <= 0.0) {
    o.pos = vec4f(0.0, 0.0, 2.0, 1.0);
    return o;
  }
  var d = screenOf(cB) - screenOf(cA);
  let l = length(d);
  if (l > 0.0001) {
    d = d / l;
  } else {
    d = vec2f(1.0, 0.0);
  }
  let halfw = u.look.w * frame.size.z * 0.5 + 1.0;
  let c = select(cA, cB, end > 0.5);
  // square ends: half a width past each (the joins between a way's stretches covered)
  let off = vec2f(-d.y, d.x) * side * halfw + d * (end * 2.0 - 1.0) * halfw;
  o.pos = clipOut(vec4f(c.xy + off / (frame.size.xy * 0.5) * c.w, c.z, c.w));
  o.across = side * halfw;
  o.halfw = halfw;
  o.cost = mix(i.hc.z, i.hc.w, end);
  let P = select(PA, PB, end > 0.5);
  o.mpp = 2.0 * length(frame.eye.xyz - P) * frame.misc.z / frame.size.y;
  return o;
}
@fragment fn fs(i: O) -> @location(0) vec4f {
  let t = clamp((i.cost - u.look.y) / max(u.look.z - u.look.y, 1.0), 0.0, 1.0);
  var rgb = mix(u.c0.rgb, u.c1.rgb, clamp(t * 2.0, 0.0, 1.0));
  rgb = mix(rgb, u.c2.rgb, clamp(t * 2.0 - 1.0, 0.0, 1.0));
  let alpha = u.look.x * clamp(i.halfw - abs(i.across), 0.0, 1.0) * clamp((i.halfw - 1.0) * 2.0, 0.0, 1.0);
  // dashes running towards the park (the walk left falls along the way)
  if (u.dash.x > 0.0) {
    let p = max(u.dash.x + u.dash.y, 0.0001);
    let at = i.cost / max(i.mpp / max(frame.size.z, 0.001), 0.000001) + frame.eye.w * u.dash.z;
    if ((at - floor(at / p) * p) > u.dash.x) {
      discard;
    }
  }
  if (alpha <= 0.002) {
    discard;
  }
  return vec4f(themed(rgb, 0.0), alpha);
}
`;
const COMMON = /* glsl */ `${FRAME_GLSL}
layout(std140) uniform U { vec4 origin; vec4 look; vec4 c0; vec4 c1; vec4 c2; vec4 dash; } u;
const float PI = 3.141592653589793;
const float RE = 6378137.0;
`;
const ROUTE_GLSL = {
  vertex: /* glsl */ `${COMMON}
layout(location = 0) in vec4 ab;
layout(location = 1) in vec4 hc;
out float v_across;
out float v_halfw;
out float v_cost;
out float v_mpp;
float s2(float a) {
  float s = sin(a * 0.5);
  return 2.0 * s * s;
}
vec3 placeAt(vec2 rel, float h) {
  float dl = u.origin.x + rel.x;
  float dm = u.origin.y + rel.y;
  float c = RE * frame.misc.y;
  vec3 F = vec3(c * dl, h, -c * dm);
  if (frame.size.w >= 1.0) {
    return F;
  }
  float lat = 2.0 * atan(exp(frame.geo.x + dm)) - PI * 0.5;
  float dp = lat - frame.misc.x;
  float rr = RE + h;
  float cl = cos(lat);
  float k = s2(dp) + frame.misc.y * cl * s2(dl);
  vec3 G = vec3(rr * cl * sin(dl), h - rr * k, -rr * (sin(dp) + frame.geo.y * cl * s2(dl)));
  return mix(G, F, frame.size.w);
}
vec2 screenOf(vec4 c) {
  return c.xy / c.w * frame.size.xy * 0.5;
}
void main() {
  uint vid = uint(gl_VertexID);
  float end = float(vid / 2u);
  float side = (vid & 1u) == 1u ? 1.0 : -1.0;
  vec3 PA = placeAt(ab.xy, hc.x * u.origin.z + u.origin.w);
  vec3 PB = placeAt(ab.zw, hc.y * u.origin.z + u.origin.w);
  vec4 cA = frame.viewProj * vec4(PA, 1.0);
  vec4 cB = frame.viewProj * vec4(PB, 1.0);
  if (cA.w <= 0.0 || cB.w <= 0.0) {
    gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
    return;
  }
  vec2 d = screenOf(cB) - screenOf(cA);
  float l = length(d);
  if (l > 0.0001) {
    d = d / l;
  } else {
    d = vec2(1.0, 0.0);
  }
  float halfw = u.look.w * frame.size.z * 0.5 + 1.0;
  vec4 c = end > 0.5 ? cB : cA;
  vec2 off = vec2(-d.y, d.x) * side * halfw + d * (end * 2.0 - 1.0) * halfw;
  gl_Position = clipOut(vec4(c.xy + off / (frame.size.xy * 0.5) * c.w, c.z, c.w));
  v_across = side * halfw;
  v_halfw = halfw;
  v_cost = mix(hc.z, hc.w, end);
  vec3 P = end > 0.5 ? PB : PA;
  v_mpp = 2.0 * length(frame.eye.xyz - P) * frame.misc.z / frame.size.y;
}
`,
  fragment: /* glsl */ `${COMMON}
in float v_across;
in float v_halfw;
in float v_cost;
in float v_mpp;
out vec4 outColor;
void main() {
  float t = clamp((v_cost - u.look.y) / max(u.look.z - u.look.y, 1.0), 0.0, 1.0);
  vec3 rgb = mix(u.c0.rgb, u.c1.rgb, clamp(t * 2.0, 0.0, 1.0));
  rgb = mix(rgb, u.c2.rgb, clamp(t * 2.0 - 1.0, 0.0, 1.0));
  float alpha = u.look.x * clamp(v_halfw - abs(v_across), 0.0, 1.0) * clamp((v_halfw - 1.0) * 2.0, 0.0, 1.0);
  if (u.dash.x > 0.0) {
    float p = max(u.dash.x + u.dash.y, 0.0001);
    float at = v_cost / max(v_mpp / max(frame.size.z, 0.001), 0.000001) + frame.eye.w * u.dash.z;
    if (mod(at, p) > u.dash.x) {
      discard;
    }
  }
  if (alpha <= 0.002) {
    discard;
  }
  outColor = vec4(themed(rgb, 0.0), alpha);
}
`,
};

/** floats a stretch: its ends (rel. to the origin), the ground under them (true m), the walk left from each (m) */
const F = 8;
export interface RouteTreeProps extends ElementProps {
  /** CSS px (default 1.8) */
  width?: number;
  opacity?: number;
  /** metres over the ground (default 1.6) */
  lift?: number;
  /** the colour scale's three stops: near, middle, far */
  ramp: [string, string, string];
  /** work still to come (a page's analysis): the layer is not settled meanwhile */
  busy?: () => boolean;
}
export class RouteTree extends Element<RouteTreeProps> {
  readonly kind = 'custom' as const;
  private prog: Program | null = null; private ubuf: GBuffer | null = null; private strip: GBuffer | null = null; private buf: GBuffer | null = null;
  private data = new Float32Array(0); private ends = new Float64Array(0); private n = 0; private cap = 0; private written = 0;
  private origin: Origin | null = null; private lo = 0; private hi = 1; private dash: [number, number, number] = [0, 0, 0];
  private U = new Float32Array(24);
  /** the ground read again a slice a frame (from this stretch), and the version it reads */
  private job = -1; private groundSeen = -1; private jobAt = -1e9;
  /** houses whose way is drawn */
  routes = 0;
  override async attach(ctx: AttachContext): Promise<void> {
    await super.attach(ctx);
    const g = ctx.graphics; if (!g) return;
    this.ubuf = g.buffer('uniform', this.U.byteLength, `${this.id} look`);
    this.strip = g.buffer('index', Uint32Array.from([0, 1, 2, 2, 1, 3]), `${this.id} quad`);
    this.prog = g.program({
      label: `route tree ${this.id}`, wgsl: ROUTE_WGSL, glsl: ROUTE_GLSL, blocks: ['Frame', 'U'],
      instance: { stride: F, attributes: [{ name: 'ab', location: 0, size: 4, offset: 0 }, { name: 'hc', location: 1, size: 4, offset: 4 }] },
      blend: 'alpha', depth: { write: false, test: 'less' },
    });
    await this.prog.ready;
    this.upload();
  }
  get size(): number { return this.routes; }
  /** the walk scale's low and high (m): only a uniform changes */
  setScale(lo: number, hi: number): void { this.lo = lo; this.hi = Math.max(lo + 1, hi); this.wake(); }
  /** dashes [on, off] px running at `flow` px a second towards the park (none: [0, 0]) */
  setDashes(on: number, off: number, flow: number): void { this.dash = [on, off, flow]; this.wake(); }
  private wake(): void { (this.attached?.world as { invalidate?: () => void } | undefined)?.invalidate?.(); }
  /** a batch of new stretches (lon, lat, walk, lon, lat, walk …) and the houses they draw; only they are written */
  append(stretches: Float64Array, houses: number): void {
    const k = stretches.length / 6; if (!k) { this.routes += houses; return; }
    this.origin ??= new Origin(stretches[0]!, stretches[1]!);
    if (this.n + k > this.cap) {
      this.cap = Math.max(1024, Math.ceil((this.n + k) * 1.5));
      const d = new Float32Array(this.cap * F); d.set(this.data.subarray(0, this.n * F)); this.data = d;
      const e = new Float64Array(this.cap * 4); e.set(this.ends.subarray(0, this.n * 4)); this.ends = e;
      this.buf?.destroy(); this.buf = null; this.written = 0;
    }
    const o = this.origin, w = this.attached?.world;
    for (let j = 0; j < k; j++) {
      const s = j * 6, i = this.n + j, r = i * F, a = o.rel(stretches[s]!, stretches[s + 1]!), b = o.rel(stretches[s + 3]!, stretches[s + 4]!);
      this.ends.set([stretches[s]!, stretches[s + 1]!, stretches[s + 3]!, stretches[s + 4]!], i * 4);
      const ha = w?.heightAt(stretches[s]!, stretches[s + 1]!) ?? 0, hb = w?.heightAt(stretches[s + 3]!, stretches[s + 4]!) ?? 0;
      this.data.set([a[0], a[1], b[0], b[1], Number.isNaN(ha) ? 0 : ha, Number.isNaN(hb) ? 0 : hb, stretches[s + 2]!, stretches[s + 5]!], r);
    }
    this.n += k; this.routes += houses;
    this.upload(); this.wake();
  }
  /** what is not on the chip yet: written (the buffer made when it grew) */
  private upload(): void {
    const g = this.attached?.graphics; if (!g || this.n === 0) return;
    if (!this.buf) { this.buf = g.buffer('instance', this.cap * F * 4, `${this.id} stretches`); this.written = 0; }
    if (this.written < this.n) { this.buf.write(this.data.subarray(this.written * F, this.n * F), this.written * F * 4); this.written = this.n; }
  }
  frame(ctx: FrameContext): DrawCall[] {
    if (!this.prog || !this.ubuf || !this.strip || !this.buf || !this.n || !this.origin) return [];
    // the ground sharpened: its heights again, a slice a frame (never a long one)
    // (at most once a second: while tiles arrive the ground changes many times a second, by little where the ways are)
    if (ctx.world.groundVersion !== this.groundSeen && this.job < 0 && performance.now() - this.jobAt > 1000) { this.groundSeen = ctx.world.groundVersion; this.job = 0; this.jobAt = performance.now(); }
    if (this.job >= 0) this.reground(ctx);
    const p = this.props, cam = ctx.camera, off = this.origin.offset(cam.lon, cam.lat), r = p.ramp.map((c) => rgba(c as never));
    this.U.set([off[0], off[1], ctx.world.exaggeration, p.lift ?? 1.6, (p.opacity ?? 1) * this.shown, this.lo, this.hi, p.width ?? 1.8]);
    this.U.set([...r[0]!, ...r[1]!, ...r[2]!], 8); this.U.set([this.dash[0], this.dash[1], this.dash[2], 0], 20);
    this.ubuf.write(this.U);
    return [{ program: this.prog, blocks: [ctx.frame, this.ubuf], instances: this.buf, index: this.strip, count: 6, instanceCount: this.n }];
  }
  private reground(ctx: FrameContext): void {
    const t0 = performance.now(), E = this.ends, d = this.data, end = this.n; let i = this.job, lo = -1, hi = -1;
    while (i < end && performance.now() - t0 < 3) {
      for (const stop = Math.min(end, i + 256); i < stop; i++) {
        // (a way's stretches follow on: this one starts where the one before ended, its height read once)
        const q = i * 4, joined = i > 0 && E[q] === E[q - 2] && E[q + 1] === E[q - 1];
        const a = joined ? d[(i - 1) * F + 5]! : ctx.world.heightAt(E[q]!, E[q + 1]!), b = ctx.world.heightAt(E[q + 2]!, E[q + 3]!);
        const ha = Math.fround(Number.isNaN(a) ? 0 : a), hb = Math.fround(Number.isNaN(b) ? 0 : b);
        if (ha !== d[i * F + 4] || hb !== d[i * F + 5]) { d[i * F + 4] = ha; d[i * F + 5] = hb; if (lo < 0) lo = i; hi = i; }
      }
    }
    if (lo >= 0 && this.buf && lo < this.written) this.buf.write(d.subarray(lo * F, Math.min(hi + 1, this.written) * F), lo * F * 4);
    this.job = i >= end ? -1 : i;
  }
  /** its frames: the ground being read again (a few), dashes running (by their pace) */
  override wantsFrames(_s: State): number { return this.job >= 0 ? Infinity : this.dash[0] > 0 && this.dash[2] && this.n ? motionFrames(Math.abs(this.dash[2])) : 0; }
  override animating(s: State): boolean { return this.wantsFrames(s) > 0; }
  override status(): ElementStatus { const st = super.status(); if (this.props.busy?.()) { st.pending.push('park access is being worked out'); st.ready = false; } return st; }
  override detach(): void { for (const b of [this.buf, this.ubuf, this.strip]) b?.destroy(); this.prog?.destroy(); this.buf = this.ubuf = this.strip = null; this.prog = null; super.detach(); }
  override readouts() { return { count: () => this.routes, stretches: () => this.n }; }
}
