// core › entities › body › draw: skinned figures on the graphics, WebGPU and WebGL2 alike. Each figure's mesh is
// one buffer shared by every instance of it; its clips sit once in a texture of skin-transform rows (dual quaternions,
// two texels a bone, the morph weights last); a body posed by your own code gets a row of its own, written when it
// changes. One draw a figure (a program a material): the instances say which two rows, how far between, where, how
// turned, how big, their 8 palette colours and their decal's numbers. Lit and shadowed like the solids (it casts).
//   const sd = new SkinDraw(graphics, 'people'); sd.rows(fig, { clip: 'walk', at: 0.3 }, key) → [a, b, t]
//   draws.push(...sd.draws(ctx, [{ figure: fig, data, n }], block, textures))
import { AslnutError } from '../../world/errors.ts';
import type { FrameContext } from '../../world/element.ts';
import type { DrawCall, GBuffer, GTexture, Graphics, Program } from '../../render/graphics/interface.ts';
import { skinWGSL } from '../../render/graphics/shaders/skin.wgsl.ts';
import { skinGLSL } from '../../render/graphics/shaders/skin.glsl.ts';
import { DQ_FLOATS } from './skeleton.ts';
import { SKIN_FLOATS, SKIN_INSTANCE_FLOATS, rowTexels, writeRow, type Figure, type Motion, type SkinMaterial } from './skin.ts';

interface Held { vbuf: GBuffer; ibuf: GBuffer; count: number; clips: Map<string, { row: number; frames: number; loop: boolean }>; inst: GBuffer | null; cap: number }
const PLAIN: SkinMaterial = { id: 'plain', wgsl: '', glsl: '' };

export class SkinDraw {
  private g: Graphics; private label: string;
  private tex: GTexture | null = null; private width = 0; private cap = 0; private used = 0; private cpu = new Float32Array(0);
  private dirty: [number, number] | null = null;
  private held = new Map<Figure, Held>();
  private live = new Map<unknown, { row: number; seen: number; sig: unknown }>(); private spare: number[] = [];
  private progs = new Map<string, Program>();
  private frameNo = 0;
  /** what the last frame drew: figures, instances, vertices */
  drawn = { figures: 0, instances: 0, vertices: 0 };
  constructor(g: Graphics, label = 'skin') { this.g = g; this.label = label; }
  /** a figure's buffers and its clips' rows (made the first time it is drawn) */
  private hold(f: Figure): Held {
    let h = this.held.get(f);
    if (h) return h;
    const need = rowTexels(f.skeleton.count);
    if (need > this.width) this.grow(need, this.cap);
    const clips = new Map<string, { row: number; frames: number; loop: boolean }>();
    for (const [name, c] of Object.entries(f.clips)) {
      const row = this.alloc(c.frames), T = rowTexels(f.skeleton.count) * 4;
      for (let k = 0; k < c.frames; k++) this.put(row + k, c.data, k * T, f.skeleton.count);
      clips.set(name, { row, frames: c.frames, loop: c.loop });
    }
    h = { vbuf: this.g.buffer('vertex', f.mesh.vertices, `${this.label} ${f.id}`), ibuf: this.g.buffer('index', f.mesh.index, `${this.label} ${f.id} index`), count: f.mesh.index.length, clips, inst: null, cap: 0 };
    this.held.set(f, h);
    return h;
  }
  /** let a figure go (its buffers; its rows are kept for the next) */
  release(f: Figure): void { const h = this.held.get(f); if (!h) return; h.vbuf.destroy(); h.ibuf.destroy(); h.inst?.destroy(); this.held.delete(f); }
  /** `n` free rows in a run (the texture grows by doubling) */
  private alloc(n: number): number {
    if (n === 1 && this.spare.length) return this.spare.pop()!;
    if (this.used + n > this.cap) {
      const max = this.g.caps.maxTex;
      if (this.used + n > max) throw new AslnutError('E-GPU-003', `${this.label}: more skin rows than the graphics hold (${max})`, { fix: 'fewer figures or shorter clips' });
      this.grow(this.width, Math.min(max, Math.max(64, (this.used + n) * 2)));
    }
    const r = this.used; this.used += n; return r;
  }
  private grow(width: number, rows: number): void {
    const old = this.cpu, ow = this.width;
    this.width = width; this.cap = Math.max(rows, 64);
    this.cpu = new Float32Array(this.width * this.cap * 4);
    // the rows held so far, each with its morph texel moved to the new last column
    for (let r = 0; r < this.used; r++) { this.cpu.set(old.subarray(r * ow * 4, r * ow * 4 + (ow - 1) * 4), r * this.width * 4); this.cpu.set(old.subarray(r * ow * 4 + (ow - 1) * 4, (r + 1) * ow * 4), (r * this.width + this.width - 1) * 4); }
    this.tex?.destroy();
    this.tex = this.g.texture({ label: `${this.label} skin rows`, width: this.width, height: this.cap, format: 'rgba32f', filter: 'nearest' });
    this.dirty = [0, this.cap];
  }
  /** a row from a clip's (or a pose's) numbers: the bones at the start, the morph weights in the last column */
  private put(row: number, src: Float32Array, at: number, bones: number): void {
    const o = row * this.width * 4;
    this.cpu.set(src.subarray(at, at + bones * DQ_FLOATS), o);
    this.cpu.set(src.subarray(at + bones * DQ_FLOATS, at + bones * DQ_FLOATS + 4), o + (this.width - 1) * 4);
    this.dirty = this.dirty ? [Math.min(this.dirty[0], row), Math.max(this.dirty[1], row + 1)] : [row, row + 1];
  }
  private scratch = new Float32Array(0);
  /** the two rows a motion is between, and how far: a clip's frames at its phase, two clips mixed, or a pose of its
   *  own (`key`: whose; written when its `key` in the motion changes, or every frame without one) */
  rows(f: Figure, m: Motion, key: unknown): [number, number, number] {
    const h = this.hold(f);
    if ('pose' in m) {
      let l = this.live.get(key);
      if (!l) { l = { row: this.alloc(1), seen: this.frameNo, sig: Symbol('none') }; this.live.set(key, l); }
      l.seen = this.frameNo;
      if (m.key === undefined || m.key !== l.sig) {
        const T = rowTexels(f.skeleton.count) * 4; if (this.scratch.length < T) this.scratch = new Float32Array(T);
        writeRow(f.skeleton, m.pose, this.scratch, 0); this.put(l.row, this.scratch, 0, f.skeleton.count); l.sig = m.key;
      }
      return [l.row, l.row, 0];
    }
    const at = (name: string, phase: number): [number, number, number] => {
      const c = h.clips.get(name) ?? h.clips.values().next().value; if (!c) return [0, 0, 0];
      const x = c.loop ? (((phase % 1) + 1) % 1) * c.frames : Math.max(0, Math.min(1, phase)) * (c.frames - 1), f0 = Math.floor(x);
      return [c.row + (f0 % c.frames), c.row + (c.loop ? (f0 + 1) % c.frames : Math.min(c.frames - 1, f0 + 1)), x - f0];
    };
    const a = at(m.clip, m.at);
    if (!m.to || m.to.mix <= 0.02) return a;
    const b = at(m.to.clip, m.to.at);
    if (m.to.mix >= 0.98) return b;
    // two clips: each at its nearest frame, mixed
    return [a[2] < 0.5 ? a[0] : a[1], b[2] < 0.5 ? b[0] : b[1], m.to.mix];
  }
  /** the program for a material (made the first time) */
  private program(mat: SkinMaterial): Program {
    let p = this.progs.get(mat.id);
    if (p) return p;
    const instance = { stride: SKIN_INSTANCE_FLOATS, attributes: [0, 1, 2, 3, 4].map((k) => ({ name: `i${k}`, location: k, size: 4 as const, offset: k * 4 })) };
    const vertex = { stride: SKIN_FLOATS, attributes: [0, 1, 2, 3].map((k) => ({ name: `a${k}`, location: 5 + k, size: 4 as const, offset: k * 4 })) };
    const textures = [{ name: 'ground', kind: '2d-array' as const, sample: 'unfilterable' as const }, { name: 'shadowMap', kind: '2d' as const, sample: 'float' as const }, { name: 'tints', kind: '2d' as const, sample: 'float' as const }, { name: 'picture', kind: '2d' as const, sample: 'float' as const }, { name: 'bones', kind: '2d' as const, sample: 'unfilterable' as const }];
    p = this.g.program({ label: `${this.label} skin ${mat.id}`, wgsl: mat.wgsl ? skinWGSL(mat.wgsl) : skinWGSL(), glsl: mat.glsl ? skinGLSL(mat.glsl) : skinGLSL(), blocks: ['Frame', 'T'], textures, instance, vertex, depth: { write: true, test: 'less' }, cull: 'none' });
    this.progs.set(mat.id, p);
    return p;
  }
  /** whether a figure's program is built (until then its instances take their far level) */
  ready(f: Figure): boolean { return this.isReady(this.program(f.material ?? PLAIN)); }
  private readyProgs = new WeakSet<Program>();
  private isReady(p: Program): boolean { if (this.readyProgs.has(p)) return true; void p.ready.then(() => this.readyProgs.add(p), () => {}); return false; }
  /** this frame's draws: each figure's instances (SKIN_INSTANCE_FLOATS each), in the frame and the sun's shadow map */
  draws(ctx: FrameContext, sets: readonly { figure: Figure; data: Float32Array; n: number; bounds: readonly number[] }[], block: GBuffer, textures: GTexture[]): DrawCall[] {
    this.frameNo++;
    // rows of poses not seen for a while go back
    if (this.frameNo % 120 === 0) for (const [k, l] of this.live) if (this.frameNo - l.seen > 240) { this.spare.push(l.row); this.live.delete(k); }
    const out: DrawCall[] = [];
    let figs = 0, inst = 0, verts = 0;
    // every figure held before any draw takes the texture (a new one may grow it)
    for (const s of sets) this.hold(s.figure);
    for (const s of sets) {
      if (!s.n) continue;
      const h = this.hold(s.figure), p = this.program(s.figure.material ?? PLAIN);
      if (!this.isReady(p)) continue;
      const bytes = s.n * SKIN_INSTANCE_FLOATS;
      if (!h.inst || bytes > h.cap) { h.inst?.destroy(); h.cap = Math.max(bytes, Math.ceil(bytes * 1.5)); const pad = new Float32Array(h.cap); pad.set(s.data.subarray(0, bytes)); h.inst = this.g.buffer('instance', pad, `${this.label} ${s.figure.id} instances`); }
      else h.inst.write(s.data.subarray(0, bytes));
      out.push({ program: p, blocks: [ctx.frame, block], textures: [...textures, this.tex!], instances: h.inst, vertices: h.vbuf, index: h.ibuf, count: h.count, instanceCount: s.n, pickProgram: () => p, cast: true, bounds: s.bounds });
      figs++; inst += s.n; verts += (s.figure.mesh.vertices.length / SKIN_FLOATS) * s.n;
    }
    // the rows written since the last frame go up at once
    if (this.dirty && this.tex) {
      const [a, b] = this.dirty, r1 = Math.min(b, this.cap);
      if (r1 > a) this.tex.write(this.cpu.subarray(a * this.width * 4, r1 * this.width * 4), { y: a, height: r1 - a, width: this.width });
      this.dirty = null;
    }
    this.drawn = { figures: figs, instances: inst, vertices: verts };
    return out;
  }
  /** bytes held on the chip: the rows, the figures' buffers */
  get bytes(): number { let b = this.width * this.cap * 16; for (const [f, h] of this.held) b += f.mesh.vertices.byteLength + f.mesh.index.byteLength + h.cap * 4; return b; }
  dispose(): void { for (const f of [...this.held.keys()]) this.release(f); this.tex?.destroy(); this.tex = null; for (const p of this.progs.values()) p.destroy(); this.progs.clear(); this.live.clear(); }
}
