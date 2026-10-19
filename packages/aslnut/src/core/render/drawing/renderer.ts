// core › render › drawing › renderer: puts a world on a canvas. It owns the graphics, the frame block every program reads, the
// size of the drawing buffer (CSS size × pixel ratio, capped by the profile), the frame loop, and reading frames back.
// Each frame it asks the world for draw calls (`tick(dtMs)`), with dt from the display (real clock) or a fixed step
// (a capture: exact frames whatever the speed). dispose() ends the loop, the observers and every graphics resource.
// Draw on demand (core › runtime › frame): with `needsFrame`, a frame nobody needs is skipped; after `rest.after` ms of
// that the loop rests (it stops asking the display for frames: a phone's main thread sleeps too) and looks every
// `rest.look` ms, or sooner when the world says a slow animation's next frame is due; wake() brings it back at once.
import { AslnutError } from '../../world/errors.ts';
import { FRAME_FLOATS, type DrawCall, type GBuffer, type Graphics } from '../graphics/interface.ts';
import type { Clock } from '../../time/clock.ts';

export interface RendererOptions {
  maxPixelRatio: number;
  clock?: Clock;
  /** a fixed pixel ratio (tests, captures) */
  pixelRatio?: number;
  clear?: [number, number, number, number];
  tick(dtMs: number): DrawCall[];
  onError?(e: unknown): void;
  /** render on change: false when nothing would change on screen (the frame is skipped; a real clock only) */
  needsFrame?(): boolean;
  /** dynamic resolution: the pixel ratio while the view moves (restored when it is still); 0 = off */
  movingPixelRatio?: number;
  /** is the view moving (dynamic resolution) */
  moving?(): boolean;
  /** smooth the picture's edges (FXAA): 'auto' (the default) while the picture is drawn smaller than the screen (the
   *  governor's resolution step, dynamic resolution); true always; false never */
  antialias?: 'auto' | boolean;
  /** a frame came more than 50 ms after the one before (a long frame): how long, and the last frame's own work */
  onLong?(gapMs: number): void;
  /** a frame drawn right after a drawn frame (the real clock): the gap between them, the display's frame time (a
   *  budget's sample; unset, nothing is measured for it) */
  onFrame?(gapMs: number): void;
  /** resting (with needsFrame): after `after` ms with no frame needed the loop stops asking the display for frames and
   *  looks every `look` ms (default { after: 500, look: 250 }; false: it never rests, a frame is asked for each display
   *  frame and skipped) */
  rest?: false | { after?: number; look?: number };
  /** ms until a frame is due by itself (a slow animation's next one; Infinity: none): a resting loop looks then */
  nextIn?(): number;
  /** work is still done between frames (the world prepares layers a zoom away): a resting loop looks sooner */
  busy?(): boolean;
  /** the loop may rest at the first frame not needed, without the wind-down (`rest.after`): the frame drawn was a
   *  change of its own (a layer shown, its opacity) on a still, settled view; the wind-down stays after motion */
  restNow?(): boolean;
}

export class Renderer {
  readonly graphics: Graphics;
  readonly canvas: HTMLCanvasElement | OffscreenCanvas;
  readonly frameBlock: GBuffer;
  readonly frameData = new Float32Array(FRAME_FLOATS);
  /** CSS size and the pixel ratio in use */
  cssWidth = 1; cssHeight = 1; pixelRatio = 1;
  clock: Clock;
  /** this frame in two parts (core › data › scenarios: compare): the calls left of `at` (0..1 of the width), the calls right of it */
  split: { at: number; left: DrawCall[]; right: DrawCall[] } | null = null;
  /** frames drawn, and the last frame's CPU time (ms) */
  frames = 0; cpuMs = 0;
  /** the last frame drawn: ms collecting its draw calls (the layers), ms handing them to the graphics */
  tickMs = 0; submitMs = 0;
  /** frames drawn and skipped (render on change); display frames not even asked for while resting, ms rested */
  drawn = 0; skipped = 0; rested = 0;
  /** the loop rests: no frame is asked of the display until something wakes it (or a look finds one needed) */
  resting = false;
  private still = 0;
  private o: RendererOptions; private raf = 0; private last = 0; private running = false; private disposed = false;
  private ro: ResizeObserver | null = null;
  /** when the last frames were drawn (real ms): fps is the ones within the last second */
  private drawnAt = new Float64Array(240); private drawnN = 0;
  private restTimer: ReturnType<typeof setTimeout> | 0 = 0; private restFrom = 0; private idleFrom = -1; private due = false;
  private loop: ((t: number) => void) | null = null;
  private reads: ((r: Promise<Uint8Array>) => void)[] = [];

  constructor(canvas: HTMLCanvasElement | OffscreenCanvas, graphics: Graphics, o: RendererOptions) {
    this.canvas = canvas; this.graphics = graphics; this.o = o; this.clock = o.clock ?? 'real';
    this.frameBlock = graphics.buffer('uniform', FRAME_FLOATS * 4, 'frame');
    this.measure();
    if (typeof ResizeObserver !== 'undefined' && 'getBoundingClientRect' in canvas) { this.ro = new ResizeObserver(() => { this.measure(); this.wake(); }); this.ro.observe(canvas as HTMLCanvasElement); }
  }
  /** a size held (a recording's frames): the drawing buffer this many pixels, whatever the canvas does, the CSS size
   *  the pixel ratio's share of it; null: the canvas's own again */
  pin(size: [number, number] | null): void {
    this.pinned = size;
    if (!size) { this.measure(); return; }
    this.cssWidth = size[0] / this.pixelRatio; this.cssHeight = size[1] / this.pixelRatio;
    this.graphics.resize(size[0], size[1]);
  }
  private pinned: [number, number] | null = null;
  /** the CSS size from the element (an OffscreenCanvas keeps its pixel size) */
  measure(): void {
    if (this.pinned) return;
    const c = this.canvas;
    const r = typeof (c as HTMLCanvasElement).getBoundingClientRect === 'function' ? (c as HTMLCanvasElement).getBoundingClientRect() : { width: c.width, height: c.height };
    this.cssWidth = Math.max(1, r.width || c.width); this.cssHeight = Math.max(1, r.height || c.height);
    const dpr = this.o.pixelRatio ?? (this.pixelRatio > 0 && this.drawn > 0 ? this.pixelRatio : this.fullRatio);
    this.pixelRatio = dpr;
    this.graphics.resize(Math.round(this.cssWidth * dpr), Math.round(this.cssHeight * dpr));
  }
  start(): void {
    if (this.running || this.disposed || this.clock === 'manual') return;
    this.running = true; this.last = 0; this.idleFrom = -1;
    const loop = (t: number) => {
      this.raf = 0;
      if (!this.running) return;
      const dt = this.last ? t - this.last : 16.7; this.last = t;
      if (dt > 50 && this.frames > 2) { try { this.o.onLong?.(dt); } catch { /* telemetry never breaks a frame */ } }
      let drew = false;
      try {
        const fixed = typeof this.clock === 'object';
        this.resolution(t);
        // render on change: a still, settled view is not drawn again (its clock waits too); a fixed clock always draws
        // (a look found a frame needed: it is drawn without asking again)
        if (!fixed && !this.due && !this.reads.length && this.o.needsFrame && !this.o.needsFrame()) { this.skipped++; this.idleDt += Math.min(250, dt); this.drewLast = false; }
        else {
          this.due = false;
          this.step(fixed ? 1000 / (this.clock as { fps: number }).fps : Math.min(250, dt + this.idleDt)); this.idleDt = 0; drew = true;
          if (this.drewLast && !fixed && this.o.onFrame) this.o.onFrame(dt);
          this.drewLast = true;
        }
      } catch (e) { this.o.onError?.(e); }
      // rest: no frame needed for a while: stop asking the display for frames (work between frames goes on at the
      // looks, sooner while there is some)
      const r = this.o.rest, after = r === false ? Infinity : r?.after ?? 500;
      if (drew) this.idleFrom = -1;
      else if (this.idleFrom < 0) this.idleFrom = t;
      // (a wake inside this frame (an invalidate from a layer) asked for the next one already: one loop, never two)
      if (this.raf) return;
      if (this.o.needsFrame && typeof this.clock !== 'object' && this.idleFrom >= 0 && (t - this.idleFrom >= after || (after !== Infinity && this.o.restNow?.()))) { this.rest(); return; }
      this.raf = requestAnimationFrame(loop);
    };
    this.loop = loop;
    this.raf = requestAnimationFrame(loop);
  }
  /** stop asking the display for frames; look again in a while (or when a slow animation's frame is due) */
  private rest(): void {
    if (!this.running || this.restTimer) return;
    if (!this.resting) { this.resting = true; this.restFrom = typeof performance !== 'undefined' ? performance.now() : Date.now(); }
    const r = this.o.rest, look = (r === false ? 250 : r?.look ?? 250), next = Math.max(0, this.o.nextIn?.() ?? Infinity), busy = this.o.busy?.() ? 32 : Infinity;
    this.restTimer = setTimeout(() => {
      this.restTimer = 0;
      if (!this.running || !this.resting) return;
      // a frame needed: drawn on the next display frame without asking again (a look with none does the work between
      // frames: layers prepared a zoom away)
      let draw = false;
      try { draw = !!this.reads.length || !this.o.needsFrame || this.o.needsFrame(); } catch (e) { this.o.onError?.(e); draw = true; }
      if (draw) { this.due = true; this.wake(); } else this.rest();
    }, Math.min(look, next, busy));
  }
  /** something changed (a touch, an invalidate, a resize, a frame to read): back to asking the display for frames */
  wake(): void {
    if (!this.running || this.disposed) return;
    if (this.restTimer) { clearTimeout(this.restTimer); this.restTimer = 0; }
    this.idleFrom = -1;
    if (this.resting) {
      const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
      this.rested += now - this.restFrom; this.idleDt += Math.min(250, now - this.restFrom);
      this.resting = false; this.last = 0; this.drewLast = false;
    }
    if (!this.raf && this.loop) this.raf = requestAnimationFrame(this.loop);
  }
  /** drawn frames in the last second (a still view that rests: 0) */
  get fps(): number {
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now(), a = this.drawnAt, n = Math.min(this.drawnN, a.length);
    let k = 0; for (let i = 0; i < n; i++) if (now - a[i]! < 1000) k++;
    return k;
  }
  private idleDt = 0; private drewLast = false;
  /** the highest pixel ratio the governor allows now (null: the device's, capped by the profile) */
  cap: number | null = null;
  /** the full pixel ratio: the device's, capped by the profile and the governor */
  /** is this frame smoothed (FXAA): asked always, or (auto) drawn smaller than the screen */
  get antialiased(): boolean {
    const a = this.o.antialias ?? 'auto'; if (a !== 'auto') return a;
    const screen = Math.min(this.o.maxPixelRatio, typeof devicePixelRatio === 'number' ? devicePixelRatio : 1);
    return this.o.pixelRatio === undefined && this.pixelRatio < screen - 0.01;
  }
  get fullRatio(): number { return Math.min(this.o.maxPixelRatio, typeof devicePixelRatio === 'number' ? devicePixelRatio : 1, this.cap ?? Infinity); }
  /** the governor's cap on the pixel ratio (a fixed pixelRatio is never changed) */
  setCap(cap: number | null): void {
    this.cap = cap; if (this.o.pixelRatio !== undefined) return;
    this.pixelRatio = this.fullRatio;
    this.graphics.resize(Math.round(this.cssWidth * this.pixelRatio), Math.round(this.cssHeight * this.pixelRatio));
  }
  /** the pixel ratio: lower while the view moves (dynamic resolution), the full one 300 ms after it stops */
  private resolution(t: number): void {
    const lo = this.o.movingPixelRatio ?? 0; if (!lo || this.o.pixelRatio !== undefined) return;
    const full = this.fullRatio; if (lo >= full) { if (this.pixelRatio !== full) { this.pixelRatio = full; this.graphics.resize(Math.round(this.cssWidth * full), Math.round(this.cssHeight * full)); } return; }
    const moving = this.o.moving?.() ?? false;
    if (moving) this.still = t;
    const want = moving || t - this.still < 300 ? lo : full;
    if (want !== this.pixelRatio) { this.pixelRatio = want; this.graphics.resize(Math.round(this.cssWidth * want), Math.round(this.cssHeight * want)); }
  }
  stop(): void { this.running = false; if (this.raf) cancelAnimationFrame(this.raf); this.raf = 0; if (this.restTimer) clearTimeout(this.restTimer); this.restTimer = 0; this.resting = false; }
  get isRunning(): boolean { return this.running; }
  /** draw one frame now, the world's clock advanced by dtMs */
  step(dtMs: number): Promise<Uint8Array> | null {
    if (this.disposed) throw new AslnutError('E-WORLD-003', 'the world was disposed', { fix: 'make a new world' });
    const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
    const draws = this.o.tick(dtMs);
    const t1 = typeof performance !== 'undefined' ? performance.now() : 0;
    this.graphics.resize(Math.round(this.cssWidth * this.pixelRatio), Math.round(this.cssHeight * this.pixelRatio));
    const want = this.reads.splice(0), split = this.split, clear = this.o.clear ?? [0, 0, 0, 1];
    let r: Promise<Uint8Array> | null;
    if (split) {
      // two scenarios side by side: the left part with its calls, then the right part beside it (the same buffers:
      // every layer wrote them once this frame)
      const W = this.graphics.width, H = this.graphics.height, x = Math.round(Math.max(0, Math.min(1, split.at)) * W);
      this.graphics.frame(split.left, { clear, scissor: [0, 0, x, H] });
      r = this.graphics.frame(split.right, { clear, keep: true, scissor: [x, 0, W - x, H], read: want.length > 0 });
    } else r = this.graphics.frame(draws, { clear, read: want.length > 0, aa: this.antialiased });
    for (const w of want) w(r!);
    this.frames++; this.drawn++;
    const t2 = typeof performance !== 'undefined' ? performance.now() : 0;
    this.drawnAt[this.drawnN++ % this.drawnAt.length] = t2;
    this.cpuMs = t2 - t0; this.tickMs = t1 - t0; this.submitMs = t2 - t1;
    return r;
  }
  /** the next frame's pixels (RGBA, top row first) */
  read(): Promise<{ width: number; height: number; pixels: Uint8Array }> {
    return new Promise((ok, bad) => {
      this.reads.push((p) => p.then((pixels) => ok({ width: this.graphics.width, height: this.graphics.height, pixels }), bad));
      if (!this.running) { try { this.step(0); } catch (e) { bad(e); } } else this.wake();
    });
  }
  dispose(): void {
    if (this.disposed) return;
    this.stop(); this.disposed = true;
    this.ro?.disconnect(); this.ro = null;
    this.graphics.destroy();
  }
}
